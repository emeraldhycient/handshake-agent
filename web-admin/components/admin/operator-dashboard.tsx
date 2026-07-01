"use client"

/**
 * OperatorDashboard — the "Dashboard" screen, reproduced pixel-for-pixel from the
 * imported Operator Console design (`docs/design-ref/screens/Dash.html`, spec §6.1)
 * with the design's OWN mock content embedded (translated from `vDash()` + `seed()`
 * in `docs/design-ref/logic.js`). This is a DESIGN reproduction: it renders the exact
 * values the design shows, with no data fetching — real-data reintegration is a
 * separate later step.
 *
 * Layout (verbatim from the design markup):
 * - Header: "Operations overview" title + subtitle, and a segmented KPI-range
 *   switcher (24h / 7d / 30d; active = dark `#16261e` chip).
 * - KPI TILES: a `repeat(4,1fr)` grid of 8 tiles (4×2); tile 0 is the dark-green
 *   "hero" (brand gradient, white ink, amber delta chip). The rest are `--card`
 *   tiles with muted delta pills (warn/amber for the attention KPIs).
 * - `1.7fr 1fr` row: the stacked-bar **Transaction volume** chart (14 bars, buy/sell/
 *   send/swap/ticket, Jun 18 → Today) and a **System health** card (provider list with
 *   halo dots + latency, plus webhook-queue / recon-drift stat boxes).
 * - `1fr 1fr` row: a **Live activity** feed and a column of **Approvals awaiting me**
 *   + **Alerts** cards.
 *
 * Wiring: the range switcher swaps the KPI values (design `mul` multiplier). Approval
 * rows and the "Open inbox →" link navigate to /approvals; alert rows navigate to
 * their destination route; nothing here moves money (§3.1).
 */
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { KpiCard } from "@/components/admin/kpi-card"
import { ChartBars } from "@/components/admin/chart-bars"
import { MakerCheckerModal } from "@/components/admin/flows"
import type { ChartBar } from "@/types/components"

// ─── Brand constants (design logic.js line 2 — NOT theme-swapped) ────────────────────

const VOL_COLORS = {
  buy: "#1a4536",
  sell: "#2a6f55",
  send: "#5a9b7a",
  swap: "#f5a623",
  ticket: "#e8b96a",
} as const

// ─── KPI range switcher (design `kpiRanges`, logic.js 487) ───────────────────────────

type RangeId = "24h" | "7d" | "30d"

const KPI_RANGES: readonly RangeId[] = ["24h", "7d", "30d"]

/** The design's per-range multiplier applied to the base KPI figures (vDash line 437). */
const RANGE_MUL: Record<RangeId, number> = { "24h": 1, "7d": 6.4, "30d": 26 }

// ─── KPI definitions (design `kpiDefs`, logic.js 439-448) ────────────────────────────
// The design derives KPI counts from its seeded dataset. `seed()` yields 3 users with
// kyc === 'pending' (i < 3) — so KYC pending = 3; 3 pending_settlement + 2 failed tx
// (i === 4/11/18 & 7/16) — so failed/stuck = 5; and `hasCase` users — 3 open cases.

// Design seed counts across the 28-user / txn mock set (vDash in the source):
// KYC pending = users with kyc pending|needs_info (13); failed/stuck = txns
// pending_settlement|failed (9); open cases = users with a compliance case (3).
const KYC_PENDING = 13
const FAILED_STUCK = 9
const OPEN_CASES = 3

/** `ngn()` — design money formatter (logic.js 332): `₦` + `en-NG` 2-dp grouping. */
function ngn(n: number): string {
  return (
    "₦" +
    Number(n).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** `f()` — design integer formatter (vDash line 438): `en-NG` grouping, no decimals. */
function fmtInt(n: number): string {
  return Number(n).toLocaleString("en-NG")
}

interface KpiDef {
  label: string
  /** Base (24h) value; scaled by the range multiplier for money/count KPIs. */
  base: number
  /** How to render the scaled value. */
  kind: "ngn" | "int" | "static"
  /** Static (non-scaled) value string — used for the seeded-count KPIs. */
  staticValue?: string
  delta: string
  note: string
  warn?: boolean
}

const KPI_DEFS: readonly KpiDef[] = [
  {
    label: "Transaction volume",
    base: 23774629,
    kind: "ngn",
    delta: "+12.4%",
    note: "vs prior",
  },
  { label: "GMV", base: 41209800, kind: "ngn", delta: "+8.1%", note: "gross" },
  {
    label: "Revenue (fees + FX)",
    base: 486300,
    kind: "ngn",
    delta: "+5.7%",
    note: "margin",
  },
  {
    label: "Transactions",
    base: 1284,
    kind: "int",
    delta: "+3.2%",
    note: "count",
  },
  {
    label: "New signups",
    base: 96,
    kind: "int",
    delta: "+18%",
    note: "new users",
  },
  {
    label: "KYC pending",
    base: 0,
    kind: "static",
    staticValue: fmtInt(KYC_PENDING),
    delta: "SLA 4h",
    note: "in queue",
    warn: true,
  },
  {
    label: "Failed / stuck tx",
    base: 0,
    kind: "static",
    staticValue: fmtInt(FAILED_STUCK),
    delta: "attention",
    note: "needs action",
    warn: true,
  },
  {
    label: "Open compliance cases",
    base: 0,
    kind: "static",
    staticValue: fmtInt(OPEN_CASES),
    delta: "2 high",
    note: "active",
    warn: true,
  },
]

/** Resolve a KPI def's value for the active range (design `kpiDefs`, vDash 440-447). */
function kpiValue(def: KpiDef, mul: number): string {
  if (def.kind === "static") return def.staticValue ?? "—"
  if (def.kind === "ngn") return ngn(def.base * mul)
  return fmtInt(Math.round(def.base * mul))
}

// ─── Transaction volume bars (design `volBars`, logic.js 461-464) ────────────────────
// 14 bars; each day's total is `40 + r*55` where `r = (sin((i+3)*1.7)+1)/2`, split into
// buy 0.34 / sell 0.22 / send 0.16 / swap 0.16 / ticket 0.12 of the total (as % heights).

const VOL_BARS: ChartBar[] = Array.from({ length: 14 }, (_, i) => {
  const r = (Math.sin((i + 3) * 1.7) + 1) / 2
  const total = 40 + r * 55
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

// ─── Page ────────────────────────────────────────────────────────────────────────────

export function OperatorDashboard() {
  const router = useRouter()
  const [range, setRange] = useState<RangeId>("24h")
  const mul = RANGE_MUL[range]

  // Approval flow — an "Approvals awaiting me" row opens the shared maker-checker
  // modal with its from→to diff (design maker-checker flow); submitting routes to
  // the real /approvals inbox where a second admin dispositions it.
  const [activeApproval, setActiveApproval] = useState<ApprovalItem | null>(
    null
  )

  const kpis = useMemo(
    () =>
      KPI_DEFS.map((def, i) => ({
        label: def.label,
        value: kpiValue(def, mul),
        delta: def.delta,
        deltaNote: def.note,
        hero: i === 0,
        tone: def.warn ? ("warn" as const) : ("success" as const),
      })),
    [mul]
  )

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
                bars={VOL_BARS}
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
