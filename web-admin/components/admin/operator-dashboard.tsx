"use client"

/**
 * OperatorDashboard — the "Dashboard" screen, reproduced pixel-for-pixel from the
 * imported Operator Console design (`docs/design-ref/screens/Dash.html`, spec §6.1).
 *
 * The KPI tiles + the 24h/7d/30d range switcher are wired to the real composite
 * operational-metrics endpoint via `useDashboardMetrics` (§8 — the shape crosses the
 * FE/BE boundary via `@handshake-agent/contracts`). Read-only projections — nothing
 * here moves money (§3.1). Four async branches: loading skeletons / error / empty
 * (no metrics access) / data.
 *
 * The volume chart, System-health card, Live-activity feed, and Approvals-awaiting-me
 * inbox still render the design's mock content: those widgets have no backing metrics
 * (per the FE/BE gap matrix — GMV, per-day-per-capability stacked series, provider
 * latency/webhook-queue/recon-drift, the activity aggregator, and the maker-checker
 * approvals subsystem are all unbuilt) and are deferred to Phase 6b backend enrichment.
 *
 * Layout (verbatim from the design markup):
 * - Header: "Operations overview" title + subtitle, and a segmented KPI-range
 *   switcher (24h / 7d / 30d; active = dark `#16261e` chip).
 * - KPI TILES: a `repeat(4,1fr)` grid of 8 tiles (4×2); tile 0 is the dark-green
 *   "hero" (brand gradient, white ink, amber delta chip). The rest are `--card`
 *   tiles with muted delta pills (warn/amber for the attention KPIs).
 * - `1.7fr 1fr` row: the stacked-bar **Transaction volume** chart and a **System
 *   health** card (both mock — Phase 6b).
 * - `1fr 1fr` row: a **Live activity** feed and a column of **Approvals awaiting me**
 *   + **Alerts** cards (both mock — Phase 6b).
 */
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { KpiCard } from "@/components/admin/kpi-card"
import { ChartBars } from "@/components/admin/chart-bars"
import { MakerCheckerModal } from "@/components/admin/flows"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardMetrics } from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import type { DashboardSummary } from "@handshake-agent/contracts"
import type { ChartBar, KpiDeltaTone } from "@/types/components"

// ─── Brand constants (design logic.js line 2 — NOT theme-swapped) ────────────────────

const VOL_COLORS = {
  buy: "#1a4536",
  sell: "#2a6f55",
  send: "#5a9b7a",
  swap: "#f5a623",
  ticket: "#e8b96a",
} as const

// ─── KPI range switcher (design `kpiRanges`, logic.js 487) ───────────────────────────
// The switcher drives the real metrics window: each preset resolves to an inclusive
// `{ from, to }` ISO-date window that `useDashboardMetrics` fetches. "24h" is sub-day
// so it maps to today only (a 1-day window — the backend takes date bounds).

type RangeId = "24h" | "7d" | "30d"

const KPI_RANGES: readonly RangeId[] = ["24h", "7d", "30d"]

/** How many days back each preset spans (inclusive of today). "24h" → today only. */
const RANGE_DAYS: Record<RangeId, number> = { "24h": 1, "7d": 7, "30d": 30 }

/** Build an inclusive `{ from, to }` ISO-date window ending today, N days back. */
function rangeForDays(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - (days - 1))
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

/** `f()` — design integer formatter (vDash line 438): `en-NG` grouping, no decimals. */
function fmtInt(n: number): string {
  return Number(n).toLocaleString("en-NG")
}

/** KYC statuses that count toward the "KYC pending" attention tile (gap matrix). */
const PENDING_KYC_STATUSES = new Set(["pending", "needs_info"])

interface Kpi {
  label: string
  value: string
  delta: string
  deltaNote: string
  hero?: boolean
  tone?: KpiDeltaTone
}

/**
 * Derive the eight KPI tiles from the real composite summary. Six are backed by the
 * metrics contract; two (GMV, Open compliance cases) have no metric to source from —
 * they render "—" and are recorded as shape gaps for Phase 6b enrichment.
 */
function deriveKpis(data: DashboardSummary): readonly Kpi[] {
  const { txnVolume, revenue, kycFunnel, activeUsers } = data
  const totalTxns = txnVolume.byType.reduce((sum, t) => sum + t.count, 0)
  const failedTxns = txnVolume.byType.reduce((sum, t) => sum + t.failed, 0)
  const pendingKyc = kycFunnel.byStatus
    .filter((s) => PENDING_KYC_STATUSES.has(s.status))
    .reduce((sum, s) => sum + s.count, 0)
  const primaryFee = revenue.totalFeesByCurrency[0]
  const revenueValue = primaryFee
    ? `${primaryFee.currency} ${primaryFee.amount}`
    : "—"
  const revenueNote =
    revenue.totalFeesByCurrency.length > 1
      ? `+${revenue.totalFeesByCurrency.length - 1} more`
      : "fees"

  return [
    // Hero: the backend surfaces per-type COUNTS, not a fiat money sum — show the
    // transaction count as the headline volume (fiat-notional volume is a shape gap).
    {
      label: "Transaction volume",
      value: fmtInt(totalTxns),
      delta: `${(txnVolume.successRate * 100).toFixed(1)}%`,
      deltaNote: "success rate",
      hero: true,
    },
    // GMV: no backend aggregation exists (gap matrix) — rendered as "—".
    { label: "GMV", value: "—", delta: "—", deltaNote: "gross" },
    // Revenue: fees only; spread is folded into FX and not separately ledgered.
    {
      label: "Revenue (fees)",
      value: revenueValue,
      delta: `${revenue.txnCount.toLocaleString()}`,
      deltaNote: revenueNote,
    },
    {
      label: "Transactions",
      value: fmtInt(totalTxns),
      delta: `${revenue.txnCount.toLocaleString()}`,
      deltaNote: "completed",
    },
    {
      label: "New signups",
      value: fmtInt(activeUsers.newInRange),
      delta: `${activeUsers.activeInRange.toLocaleString()}`,
      deltaNote: "active",
    },
    {
      label: "KYC pending",
      value: fmtInt(pendingKyc),
      delta: "SLA 4h",
      deltaNote: "in queue",
      tone: "warn",
    },
    {
      label: "Failed / stuck tx",
      value: fmtInt(failedTxns),
      delta: "attention",
      deltaNote: "needs action",
      tone: "warn",
    },
    // Open compliance cases: no metric count (gap matrix) — rendered as "—".
    {
      label: "Open compliance cases",
      value: "—",
      delta: "—",
      deltaNote: "active",
      tone: "warn",
    },
  ]
}

// ─── Transaction volume bars (design `volBars`, logic.js 461-464) — MOCK (Phase 6b) ──
// 14 bars; each day's total is `40 + r*55` where `r = (sin((i+3)*1.7)+1)/2`, split into
// buy 0.34 / sell 0.22 / send 0.16 / swap 0.16 / ticket 0.12 of the total (as % heights).
//
// This stacked-by-capability silhouette has no backing metric: the composite endpoint
// gives a flat per-day total + per-type totals, NOT a per-day-per-type cross-tab (gap
// matrix), so the chart stays mock. It still rescopes with the range switcher (the day
// count shifts the sine phase/frequency so the silhouette visibly changes per range)
// while the per-segment proportions and axis labels stay identical.

/** Build the 14-day stacked mock bars, reseeded by the range's day-count (`days`). */
function volBarsFor(days: number): ChartBar[] {
  return Array.from({ length: 14 }, (_, i) => {
    const r = (Math.sin((i + 3) * 1.7 + days) + 1) / 2
    const total = (40 + r * 55) * days
    return {
      label: i === 0 ? "Jun 18" : i === 13 ? "Today" : `Day ${i + 1}`,
      segments: {
        buy: total * 0.34,
        sell: total * 0.22,
        send: total * 0.16,
        swap: total * 0.16,
        ticket: total * 0.12,
      },
    }
  })
}

// ─── System health rows (design `health`, logic.js 466-472) ──────────────────────────

interface HealthRow {
  name: string
  note: string
  status: string
  dot: string
  halo: string
  /** Right-aligned status colour token. */
  fg: string
}

const HEALTH: readonly HealthRow[] = [
  {
    name: "Blockradar",
    note: "Custodial WaaS · TRON",
    status: "120ms",
    dot: "#1f8a5b",
    halo: "rgba(31,138,91,0.18)",
    fg: "var(--tok)",
  },
  {
    name: "Flutterwave",
    note: "NGN rails",
    status: "890ms",
    dot: "#e0a53a",
    halo: "rgba(224,165,58,0.2)",
    fg: "var(--twn)",
  },
  {
    name: "Resend",
    note: "Email",
    status: "70ms",
    dot: "#1f8a5b",
    halo: "rgba(31,138,91,0.18)",
    fg: "var(--tok)",
  },
  {
    name: "WhatsApp Cloud",
    note: "Chat + Flows",
    status: "210ms",
    dot: "#1f8a5b",
    halo: "rgba(31,138,91,0.18)",
    fg: "var(--tok)",
  },
  {
    name: "Anthropic LLM",
    note: "claude-opus-4-8",
    status: "640ms",
    dot: "#1f8a5b",
    halo: "rgba(31,138,91,0.18)",
    fg: "var(--tok)",
  },
]

const WEBHOOK_Q = "3"
/** `recon.filter(open).length` open breaks (seed rc1-rc3 open) + " open" (vDash 488). */
const RECON_DRIFT = "3 open"

// ─── Live activity feed (design `activity`, logic.js 473-480) ────────────────────────

interface ActivityItem {
  text: string
  meta: string
  time: string
  /** Inline SVG path (design `a.icon`). */
  icon: string
  iconBg: string
  iconFg: string
}

const ACTIVITY: readonly ActivityItem[] = [
  {
    text: "Buy settled · Amara Okeke",
    meta: "tx_80231 · 120.00 USDT",
    time: "2m",
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sok)",
    iconFg: "var(--tok)",
  },
  {
    text: "KYC approved · Emeka Okonkwo",
    meta: "tier_1 · by Ifeoma Bello",
    time: "8m",
    icon: "M12 3l7 3v5c0 5-3.5 8-7 9",
    iconBg: "var(--sif)",
    iconFg: "var(--tif)",
  },
  {
    text: "Config change submitted",
    meta: "FX spread 85→110 bps",
    time: "34m",
    icon: "M4 7h16M4 12h10M4 17h7",
    iconBg: "var(--swn)",
    iconFg: "var(--twn)",
  },
  {
    text: "Send failed · retry queued",
    meta: "tx_80238 · Blockradar timeout",
    time: "52m",
    icon: "M12 4l9 16H3z",
    iconBg: "var(--sdn)",
    iconFg: "var(--tdn)",
  },
  {
    text: "Sweep confirmed",
    meta: "child addr · 42.4 TRX",
    time: "1h",
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sok)",
    iconFg: "var(--tok)",
  },
  {
    text: "Refund executed by engine",
    meta: "tx_80219 · ₦45,000.00",
    time: "2h",
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sif)",
    iconFg: "var(--tif)",
  },
]

// ─── Approvals awaiting me (design `myApprovals`, logic.js 481 — first 3 approvals) ──
// `st.approvals.slice(0,3)` from the seeded maker-checker inbox (logic.js 75-80), each
// carrying the from→to diff the maker-checker modal renders.

interface ApprovalItem {
  title: string
  by: string
  ago: string
  diff: readonly { field: string; from: string; to: string }[]
}

const MY_APPROVALS: readonly ApprovalItem[] = [
  {
    title: "USDT/NGN buy spread 85 → 110 bps",
    by: "Tunde Adeyemi",
    ago: "34m ago",
    diff: [
      { field: "crypto.buy · USDT/NGN spread", from: "85 bps", to: "110 bps" },
    ],
  },
  {
    title: "Disable swap (global)",
    by: "Amara Okeke",
    ago: "1h ago",
    diff: [{ field: "capability: swap", from: "Enabled", to: "Disabled" }],
  },
  {
    title: "Partial refund — tx_80257 · ₦180,000.00",
    by: "Kelechi Chukwu",
    ago: "2h ago",
    diff: [{ field: "Refund amount", from: "₦0.00", to: "₦180,000.00" }],
  },
]

// ─── Alerts (design `alerts`, logic.js 482-486) ──────────────────────────────────────

interface AlertItem {
  title: string
  desc: string
  bg: string
  fg: string
  icon: string
  /** Destination route (design `onTap`). */
  route: string
}

const ALERTS: readonly AlertItem[] = [
  {
    title: "Sanctions hit — name match",
    desc: "Bola Balogun matched OFAC SDN at 0.82. Review required.",
    bg: "var(--sdn)",
    fg: "var(--tdn)",
    icon: "M12 4l9 16H3zM12 10v4",
    route: "/sanctions",
  },
  {
    title: "Over-credit flagged",
    desc: "tx_80257 — +70.00 USDT above ledger. Not auto-debited.",
    bg: "var(--swn)",
    fg: "var(--twn)",
    icon: "M12 13l4-4M4 18a8 8 0 1 1 16 0",
    route: "/reconciliation",
  },
  {
    title: "Provider incident",
    desc: "Flutterwave NGN payouts degraded.",
    bg: "var(--swn)",
    fg: "var(--twn)",
    icon: "M12 4l9 16H3z",
    route: "/ops",
  },
]

// ─── Shared card + title primitives (design §5) ──────────────────────────────────────

/** Feature card — radius 18px, 1px `--line` border, `--card` surface, 20/22 padding. */
function FeatureCard({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-line bg-card px-[22px] py-5",
        className
      )}
    >
      {children}
    </div>
  )
}

// ─── Cards ───────────────────────────────────────────────────────────────────────────

function SystemHealthCard() {
  return (
    <FeatureCard className="flex flex-col">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-sm font-bold text-ink">System health</div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-tok">
          <span
            aria-hidden
            className="size-[14px] rounded-full border-2 border-current border-t-transparent motion-safe:animate-hs-spin"
          />
          Live
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {HEALTH.map((h) => (
          <div
            key={h.name}
            className="flex items-center gap-[11px] border-b border-line2 py-[9px] last:border-0"
          >
            <span
              aria-hidden
              className="size-2 flex-none rounded-full"
              style={{ background: h.dot, boxShadow: `0 0 0 3px ${h.halo}` }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-ink">
                {h.name}
              </div>
              <div className="text-[10.5px] text-ink3">{h.note}</div>
            </div>
            <span
              className="text-[11px] font-bold tabular-nums"
              style={{ color: h.fg }}
            >
              {h.status}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-auto flex gap-[9px] pt-3.5">
        <div className="flex-1 rounded-[10px] bg-card2 px-[11px] py-[9px]">
          <div className="text-[10.5px] font-semibold text-ink3">
            Webhook queue
          </div>
          <div className="mt-px text-base font-extrabold text-ink tabular-nums">
            {WEBHOOK_Q}
          </div>
        </div>
        <div className="flex-1 rounded-[10px] bg-card2 px-[11px] py-[9px]">
          <div className="text-[10.5px] font-semibold text-ink3">
            Recon drift
          </div>
          <div className="mt-px text-base font-extrabold text-twn tabular-nums">
            {RECON_DRIFT}
          </div>
        </div>
      </div>
    </FeatureCard>
  )
}

function LiveActivityCard() {
  return (
    <FeatureCard>
      <div className="mb-3 text-sm font-bold text-ink">Live activity</div>
      <div className="flex flex-col">
        {ACTIVITY.map((a, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-line2 py-[9px] last:border-0"
          >
            <span
              aria-hidden
              className="flex size-[30px] flex-none items-center justify-center rounded-[9px]"
              style={{ background: a.iconBg, color: a.iconFg }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path
                  d={a.icon}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink">
                {a.text}
              </div>
              <div className="font-mono text-[10.5px] text-ink3 tabular-nums">
                {a.meta}
              </div>
            </div>
            <span className="flex-none text-[10.5px] text-ink3 tabular-nums">
              {a.time}
            </span>
          </div>
        ))}
      </div>
    </FeatureCard>
  )
}

function ApprovalsCard({
  onOpen,
}: {
  onOpen: (approval: ApprovalItem) => void
}) {
  return (
    <FeatureCard>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-bold text-ink">Approvals awaiting me</div>
        <Link
          href="/approvals"
          className="text-xs font-bold text-tif outline-none hover:underline focus-visible:underline"
        >
          Open inbox →
        </Link>
      </div>
      {MY_APPROVALS.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onOpen(a)}
          className="flex w-full items-center gap-[11px] border-b border-line2 py-2.5 text-left last:border-0 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="size-2 flex-none rounded-full bg-brand-amber"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-ink">
              {a.title}
            </div>
            <div className="text-[10.5px] text-ink3">
              by {a.by} · {a.ago}
            </div>
          </div>
          <span className="flex-none rounded-full bg-swn px-2 py-0.5 text-[10.5px] font-bold text-twn">
            Pending
          </span>
        </button>
      ))}
    </FeatureCard>
  )
}

function AlertsCard() {
  const router = useRouter()
  return (
    <FeatureCard className="flex-1">
      <div className="mb-3 text-sm font-bold text-ink">Alerts</div>
      {ALERTS.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => router.push(a.route)}
          className="flex w-full items-start gap-[11px] border-b border-line2 py-2.5 text-left last:border-0 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="mt-px flex size-[26px] flex-none items-center justify-center rounded-lg"
            style={{ background: a.bg, color: a.fg }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d={a.icon}
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-ink">
              {a.title}
            </div>
            <div className="text-[11px] leading-[1.4] text-ink2">{a.desc}</div>
          </div>
        </button>
      ))}
    </FeatureCard>
  )
}

// ─── KPI grid — the metrics-backed data branch (§8) ──────────────────────────────────

/** The 4×2 KPI tile grid rendered from the real composite summary (data branch). */
function KpiGrid({ data }: { data: DashboardSummary }) {
  const kpis = useMemo(() => deriveKpis(data), [data])
  return (
    <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => (
        <KpiCard
          key={k.label}
          label={k.label}
          value={k.value}
          delta={k.delta}
          deltaNote={k.deltaNote}
          hero={k.hero}
          tone={k.tone}
        />
      ))}
    </div>
  )
}

/** Loading placeholder for the KPI grid — 8 tile-sized skeletons in the 4×2 grid. */
function KpiGridSkeleton() {
  return (
    <div
      className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      aria-busy="true"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-2xl" />
      ))}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────────────

export function OperatorDashboard() {
  const router = useRouter()
  const [range, setRange] = useState<RangeId>("24h")

  // Approval flow — an "Approvals awaiting me" row opens the shared maker-checker
  // modal with its from→to diff (design maker-checker flow); submitting routes to
  // the real /approvals inbox where a second admin dispositions it.
  const [activeApproval, setActiveApproval] = useState<ApprovalItem | null>(
    null
  )

  // The KPI tiles + range switcher are wired to the real composite metrics endpoint.
  const days = RANGE_DAYS[range]
  const metricsRange = useMemo(() => rangeForDays(days), [days])
  const query = useDashboardMetrics(metricsRange)
  const isForbidden =
    query.error instanceof ApiError && query.error.status === 403

  // Rescope the (still-mock) stacked-bar chart to the selected range: the bar
  // silhouette visibly changes per range while colours/labels stay identical.
  const volBars = useMemo(() => volBarsFor(days), [days])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-[1320px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header + KPI-range switcher (design lines 3-13) ────────────────────── */}
        <div className="mb-[22px] flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
              Operations overview
            </h1>
            <p className="mt-[5px] text-[13.5px] text-ink2">
              Live platform health, money movement, and what needs your
              attention.
            </p>
          </div>
          <div
            role="group"
            aria-label="Date range"
            className="flex rounded-[11px] border border-line bg-card p-[3px]"
          >
            {KPI_RANGES.map((r) => {
              const active = r === range
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRange(r)}
                  className={cn(
                    "cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    active
                      ? "bg-btn-dark text-white"
                      : "text-ink2 hover:text-ink"
                  )}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── KPI TILES — 4×2 grid, tile 0 = hero (design lines 16-27) ───────────── */}
        {/* Four async branches: loading skeletons / error / empty (no access) / data. */}
        {query.isLoading && <KpiGridSkeleton />}

        {query.isError &&
          (isForbidden ? (
            <div className="mb-4 rounded-[18px] border border-swn bg-swn/40 p-6 text-center">
              <p className="text-sm font-bold text-twn">No metrics access</p>
              <p className="mt-1 text-[12.5px] text-ink2">
                Your role can&apos;t view the operational dashboard. Ask a super
                admin to grant the Metrics permission.
              </p>
            </div>
          ) : (
            <div className="mb-4 rounded-[18px] border border-sdn bg-sdn/40 p-6 text-center">
              <p className="text-sm font-bold text-tdn">
                Failed to load metrics
              </p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="mt-2 cursor-pointer rounded-[8px] bg-btn-dark px-3.5 py-1.5 text-[12.5px] font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Retry
              </button>
            </div>
          ))}

        {query.isSuccess && <KpiGrid data={query.data} />}

        {/* ── Volume chart + System health (design lines 29-77) ─────────────────── */}
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
          <FeatureCard>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-ink">
                  Transaction volume
                </div>
                <div className="mt-0.5 text-xs text-ink2 tabular-nums">
                  by day · stacked by capability
                </div>
              </div>
              <div className="flex flex-wrap gap-[13px]">
                {(
                  [
                    ["buy", VOL_COLORS.buy],
                    ["sell", VOL_COLORS.sell],
                    ["send", VOL_COLORS.send],
                    ["swap", VOL_COLORS.swap],
                    ["ticket", VOL_COLORS.ticket],
                  ] as const
                ).map(([label, color]) => (
                  <div key={label} className="flex items-center gap-[5px]">
                    <span
                      aria-hidden
                      className="size-[9px] rounded-[3px]"
                      style={{ background: color }}
                    />
                    <span className="text-[11px] font-semibold text-ink2">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <ChartBars
                bars={volBars}
                ariaLabel="Transaction volume by day, stacked by capability, Jun 18 to today"
                showLegend={false}
              />
            </div>
          </FeatureCard>

          <SystemHealthCard />
        </div>

        {/* ── Attention row — Live activity | (Approvals + Alerts) (lines 79-120) ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LiveActivityCard />
          <div className="flex flex-col gap-4">
            <ApprovalsCard onOpen={setActiveApproval} />
            <AlertsCard />
          </div>
        </div>
      </div>

      {/* Maker-checker flow modal for the selected approval (design flow §5). */}
      <MakerCheckerModal
        open={activeApproval !== null}
        onOpenChange={(open) => {
          if (!open) setActiveApproval(null)
        }}
        title={activeApproval?.title ?? ""}
        diff={activeApproval ? [...activeApproval.diff] : []}
        onSubmit={() => {
          setActiveApproval(null)
          router.push("/approvals")
        }}
      />
    </div>
  )
}
