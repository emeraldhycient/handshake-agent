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
 * The GMV tile and the Transaction-volume chart are wired to the real composite
 * metrics (GMV = the summed fiat notional of completed money-moving txns; the chart =
 * `txnVolume.stackedSeries`). The System-health card, Live-activity feed, and the
 * Open-compliance KPI tile are now wired to the real operational-ops endpoint
 * (`useMetricsOps` → GET /admin/metrics/ops): per-provider dispatch status +
 * webhook-queue depth + recon drift, a cross-domain activity feed (settled/failed
 * txns, KYC + config-change audit events, engine sweeps/refunds), and the open
 * (flagged + under_review) compliance-case count. The Approvals-awaiting-me panel is
 * wired to the real maker-checker inbox (`useApprovalsInbox` → GET
 * /admin/approvals/inbox) — awaiting-me count badge + a teaser of pending requests,
 * linking to the full /approvals inbox where they are dispositioned (Phase 7).
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
 *   (real — Phase 7 inbox) + **Alerts** cards (Alerts still mock — Phase 6b).
 */
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { rangeForDays } from "@/lib/metrics-range"
import { KpiCard } from "@/components/admin/kpi-card"
import { ChartBars } from "@/components/admin/chart-bars"
import { useOperatorAlerts, type AdminAlert } from "@/components/admin/use-operator-alerts"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useApprovalsInbox,
  useDashboardMetrics,
  useMetricsOps,
} from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import type {
  ActivityEvent,
  ActivityKind,
  ChangeRequest,
  ChangeRequestKind,
  DashboardSummary,
  MetricsOps,
  ProviderHealth,
} from "@handshake-agent/contracts"
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
// The switcher drives the real metrics window: each preset resolves to a rolling
// `{ from, to }` window that `useDashboardMetrics` fetches. The bounds are FULL ISO
// timestamps ending at `now` — NOT date-only strings. Date-only `to` floored to
// midnight-of-today, which excluded everything created today and made "24h" a
// zero-width (from === to) window that always returned zeros.

type RangeId = "24h" | "7d" | "30d"

const KPI_RANGES: readonly RangeId[] = ["24h", "7d", "30d"]

/** How many rolling days back each preset spans. "24h" → the last 24 hours. */
const RANGE_DAYS: Record<RangeId, number> = { "24h": 1, "7d": 7, "30d": 30 }

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
 * Derive the eight KPI tiles from the real composite summary. Seven are backed by the
 * composite metrics contract (including GMV); the eighth (Open compliance cases) is
 * sourced from the ops endpoint's open (flagged + under_review) count, or "—" while
 * that read is still loading / forbidden.
 */
function deriveKpis(
  data: DashboardSummary,
  openComplianceCases: number | undefined
): readonly Kpi[] {
  const { txnVolume, gmv, revenue, kycFunnel, activeUsers } = data
  const totalTxns = txnVolume.byType.reduce((sum, t) => sum + t.count, 0)
  const failedTxns = txnVolume.byType.reduce((sum, t) => sum + t.failed, 0)
  // Stuck = in-flight (pending/validating/confirmed/settling) per the same
  // definition as the sidebar stuck badge, so the two agree (Phase 8 drift fix).
  const stuckTxns = txnVolume.byType.reduce((sum, t) => sum + t.stuck, 0)
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

  // GMV: the summed fiat notional of completed money-moving txns (primary
  // currency). "—" only when no completed txn carried a fiat notional in range.
  const primaryGmv = gmv.totalByCurrency[0]
  const gmvValue = primaryGmv
    ? `${primaryGmv.currency} ${primaryGmv.amount}`
    : "—"
  const gmvNote =
    gmv.totalByCurrency.length > 1
      ? `+${gmv.totalByCurrency.length - 1} more`
      : "gross"

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
    // GMV: summed fiat notional of completed money-moving txns (Phase 6b enrichment).
    {
      label: "GMV",
      value: gmvValue,
      delta: `${gmv.txnCount.toLocaleString()}`,
      deltaNote: gmvNote,
    },
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
      label: "Failed · stuck tx",
      value: `${fmtInt(failedTxns)} · ${fmtInt(stuckTxns)}`,
      delta: "attention",
      deltaNote: "failed · stuck",
      tone: "warn",
    },
    // Open compliance cases: the open (flagged + under_review) count from the ops
    // endpoint. "—" only while that read is loading or forbidden.
    {
      label: "Open compliance cases",
      value:
        openComplianceCases === undefined
          ? "—"
          : fmtInt(openComplianceCases),
      delta: openComplianceCases === undefined ? "—" : "open",
      deltaNote: "flagged + review",
      tone: "warn",
    },
  ]
}

// ─── Transaction volume bars — real per-day-per-capability series (Phase 6b) ─────────
// The composite endpoint now projects `txnVolume.stackedSeries`: one bucket per UTC
// day carrying the buy/sell/send/swap/ticket counts. We map each bucket straight onto
// a ChartBar segment set, so the stacked silhouette reflects real settled volume and
// rescopes with the range switcher (the returned day-set follows the {from,to} window).

/** Short "MMM D" axis label for a YYYY-MM-DD bucket date (UTC, locale-independent). */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const

function bucketLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-")
  const monthName = MONTHS[Number(month) - 1] ?? month
  return `${monthName} ${Number(day)}`
}

/** Map the real per-day stacked series onto the ChartBars segment shape. */
function volBarsFrom(
  stackedSeries: DashboardSummary["txnVolume"]["stackedSeries"]
): ChartBar[] {
  return stackedSeries.map((bucket) => ({
    label: bucketLabel(bucket.date),
    segments: {
      buy: bucket.buy,
      sell: bucket.sell,
      send: bucket.send,
      swap: bucket.swap,
      ticket: bucket.ticket,
    },
  }))
}

// ─── System health rows — wired to the real ops endpoint (design `health`) ───────────
// The design's per-provider row is preserved (dot + halo + right-aligned status
// colour), but the values come from `MetricsOps.systemHealth`: the provider status
// drives the dot/tint, and the observed latency (or "—" when unmeasured) fills the
// right-aligned status slot the design used for a latency figure.

interface HealthRow {
  name: string
  note: string
  /** Right-aligned status label — observed latency ("120ms") or "—". */
  status: string
  dot: string
  halo: string
  /** Right-aligned status colour token. */
  fg: string
}

/** Design status-tint tokens per provider status (ok=success, degraded=warn, down=danger). */
const STATUS_STYLE: Record<
  ProviderHealth["status"],
  { dot: string; halo: string; fg: string }
> = {
  ok: { dot: "#1f8a5b", halo: "rgba(31,138,91,0.18)", fg: "var(--tok)" },
  degraded: { dot: "#e0a53a", halo: "rgba(224,165,58,0.2)", fg: "var(--twn)" },
  down: { dot: "#d0453b", halo: "rgba(208,69,59,0.2)", fg: "var(--tdn)" },
}

/** Map one contract provider-health row onto the design's HealthRow view shape. */
function healthRowFrom(provider: ProviderHealth): HealthRow {
  const style = STATUS_STYLE[provider.status]
  return {
    name: provider.name,
    note: provider.note,
    status:
      provider.lastLatencyMs === null ? "—" : `${provider.lastLatencyMs}ms`,
    dot: style.dot,
    halo: style.halo,
    fg: style.fg,
  }
}

// ─── Live activity feed — wired to the real ops endpoint (design `activity`) ─────────
// The design's row (icon + tint + text/meta/time) is preserved; the data comes from
// `MetricsOps.activityFeed`. Each event `kind` selects the icon + tint the design
// used; `title`/`meta` render verbatim; the ISO `at` becomes a relative label.

interface ActivityItem {
  text: string
  meta: string
  time: string
  /** Inline SVG path (design `a.icon`). */
  icon: string
  iconBg: string
  iconFg: string
}

/** Per-kind icon + tint (mirrors the design's settled/kyc/config/failed/sweep/refund rows). */
const ACTIVITY_STYLE: Record<
  ActivityKind,
  { icon: string; iconBg: string; iconFg: string }
> = {
  settled: {
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sok)",
    iconFg: "var(--tok)",
  },
  kyc_approved: {
    icon: "M12 3l7 3v5c0 5-3.5 8-7 9",
    iconBg: "var(--sif)",
    iconFg: "var(--tif)",
  },
  config_change: {
    icon: "M4 7h16M4 12h10M4 17h7",
    iconBg: "var(--swn)",
    iconFg: "var(--twn)",
  },
  failed: {
    icon: "M12 4l9 16H3z",
    iconBg: "var(--sdn)",
    iconFg: "var(--tdn)",
  },
  sweep: {
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sok)",
    iconFg: "var(--tok)",
  },
  refund: {
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sif)",
    iconFg: "var(--tif)",
  },
}

/** Compact relative-time label ("2m" / "3h" / "5d") from an ISO timestamp. */
function relativeTime(iso: string, now: number = Date.now()): string {
  const deltaMs = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Map one contract activity event onto the design's ActivityItem view shape. */
function activityItemFrom(event: ActivityEvent): ActivityItem {
  const style = ACTIVITY_STYLE[event.kind]
  return {
    text: event.title,
    meta: event.meta,
    time: relativeTime(event.at),
    icon: style.icon,
    iconBg: style.iconBg,
    iconFg: style.iconFg,
  }
}

// ─── Approvals awaiting me — wired to the real maker-checker inbox (Phase 7) ──────────
// The dashboard panel shows the first few of `awaitingMe` (pending change requests a
// different admin raised that THIS admin may approve) + the awaiting-me count badge.
// Dispositions happen on the full /approvals inbox — the panel is a read-only teaser.

/** Human label per change-request kind (mirrors the Approvals page kind pills). */
const APPROVAL_KIND_LABEL: Record<ChangeRequestKind, string> = {
  pricing_change: "Pricing change",
  capability_flip: "Capability",
  tier_override: "Tier override",
  refund: "Refund",
  manual_credit: "Manual credit",
  notification_broadcast: "Broadcast",
  payout_release: "Payout release",
}

/** How many awaiting-me requests the dashboard teaser shows. */
const APPROVALS_PANEL_LIMIT = 3

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

/**
 * System-health card — wired to `MetricsOps.systemHealth`. Four async branches:
 * loading skeleton / error (no-access or generic, both fall back to "unavailable")
 * / empty (no providers) / data (per-provider rows + queue/recon footer).
 */
function SystemHealthCard({
  ops,
  isLoading,
  isError,
}: {
  ops: MetricsOps | undefined
  isLoading: boolean
  isError: boolean
}) {
  const rows = ops ? ops.systemHealth.providers.map(healthRowFrom) : []
  const reconDrift = ops?.systemHealth.reconDriftCount ?? 0

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

      {isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[38px] rounded-[8px]" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Health metrics unavailable.
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          No providers registered.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((h) => (
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
      )}

      <div className="mt-auto flex gap-[9px] pt-3.5">
        <div className="flex-1 rounded-[10px] bg-card2 px-[11px] py-[9px]">
          <div className="text-[10.5px] font-semibold text-ink3">
            Webhook queue
          </div>
          <div className="mt-px text-base font-extrabold text-ink tabular-nums">
            {ops ? fmtInt(ops.systemHealth.webhookQueueDepth) : "—"}
          </div>
        </div>
        <div className="flex-1 rounded-[10px] bg-card2 px-[11px] py-[9px]">
          <div className="text-[10.5px] font-semibold text-ink3">
            Recon drift
          </div>
          <div
            className={cn(
              "mt-px text-base font-extrabold tabular-nums",
              reconDrift > 0 ? "text-twn" : "text-ink"
            )}
          >
            {ops ? `${fmtInt(reconDrift)} open` : "—"}
          </div>
        </div>
      </div>
    </FeatureCard>
  )
}

/**
 * Live-activity card — wired to `MetricsOps.activityFeed`. Four async branches:
 * loading skeleton / error / empty (no recent events) / data (the event rows).
 */
function LiveActivityCard({
  ops,
  isLoading,
  isError,
}: {
  ops: MetricsOps | undefined
  isLoading: boolean
  isError: boolean
}) {
  const items = ops ? ops.activityFeed.map(activityItemFrom) : []

  return (
    <FeatureCard>
      <div className="mb-3 text-sm font-bold text-ink">Live activity</div>
      {isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[42px] rounded-[9px]" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Activity feed unavailable.
        </div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          No recent activity.
        </div>
      ) : (
        <div className="flex flex-col">
          {items.map((a, i) => (
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
      )}
    </FeatureCard>
  )
}

/**
 * Approvals-awaiting-me teaser — wired to `useApprovalsInbox`. The header carries
 * the awaiting-me count badge; the body lists the first few pending requests a
 * different admin raised. Four async branches: loading skeleton / error / empty
 * (inbox zero) / data. Rows link to the full /approvals inbox where they are
 * dispositioned — the dashboard never approves (that lives on the Approvals page).
 */
function ApprovalsCard() {
  const inbox = useApprovalsInbox()
  const awaiting = inbox.data?.awaitingMe ?? []
  const count = inbox.data?.counts.awaitingMe ?? awaiting.length
  const rows = awaiting.slice(0, APPROVALS_PANEL_LIMIT)

  return (
    <FeatureCard>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink">
            Approvals awaiting me
          </span>
          {inbox.isSuccess && count > 0 && (
            <span className="rounded-full bg-swn px-2 py-0.5 text-[10.5px] font-bold text-twn tabular-nums">
              {count}
            </span>
          )}
        </div>
        <Link
          href="/approvals"
          className="text-xs font-bold text-tif outline-none hover:underline focus-visible:underline"
        >
          Open inbox →
        </Link>
      </div>

      {inbox.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[38px] rounded-[8px]" />
          ))}
        </div>
      ) : inbox.isError ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Approvals inbox unavailable.
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Nothing awaiting your approval.
        </div>
      ) : (
        rows.map((cr: ChangeRequest) => (
          <Link
            key={cr.id}
            href="/approvals"
            className="flex w-full items-center gap-[11px] border-b border-line2 py-2.5 text-left last:border-0 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="size-2 flex-none rounded-full bg-brand-amber"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink">
                {APPROVAL_KIND_LABEL[cr.kind]} · {cr.resource}
              </div>
              <div className="text-[10.5px] text-ink3">
                by {cr.requestedByEmail ?? cr.requestedByAdminId}
              </div>
            </div>
            <span className="flex-none rounded-full bg-swn px-2 py-0.5 text-[10.5px] font-bold text-twn">
              Pending
            </span>
          </Link>
        ))
      )}
    </FeatureCard>
  )
}

/** Icon-chip token per alert tone (status semantic, never colour alone). */
const ALERT_TONE_CHIP: Record<AdminAlert["tone"], string> = {
  danger: "bg-[color:var(--danger-muted)] text-[color:var(--destructive)]",
  warn: "bg-[color:var(--warn-muted)] text-[color:var(--warn)]",
  info: "bg-[color:var(--info-muted)] text-[color:var(--info)]",
}

function AlertsCard() {
  const router = useRouter()
  // LIVE alerts derived from the same source hooks as the topbar bell (shared
  // useOperatorAlerts) — never a hardcoded list. Empty = "All clear".
  const alerts = useOperatorAlerts()
  return (
    <FeatureCard className="flex-1">
      <div className="mb-3 text-sm font-bold text-ink">Alerts</div>
      {alerts.length === 0 ? (
        <div className="py-2.5 text-[12px] text-ink2">
          All clear — no operational alerts.
        </div>
      ) : (
        alerts.map((a) => {
          const Icon = a.icon
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => router.push(a.href)}
              className="flex w-full items-start gap-[11px] border-b border-line2 py-2.5 text-left last:border-0 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-px flex size-[26px] flex-none items-center justify-center rounded-lg",
                  ALERT_TONE_CHIP[a.tone]
                )}
              >
                <Icon className="size-[14px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">
                  {a.title}
                </div>
                <div className="text-[11px] leading-[1.4] text-ink2">
                  {a.description}
                </div>
              </div>
            </button>
          )
        })
      )}
    </FeatureCard>
  )
}

// ─── KPI grid — the metrics-backed data branch (§8) ──────────────────────────────────

/** The 4×2 KPI tile grid rendered from the real composite summary (data branch). */
function KpiGrid({
  data,
  openComplianceCases,
}: {
  data: DashboardSummary
  openComplianceCases: number | undefined
}) {
  const kpis = useMemo(
    () => deriveKpis(data, openComplianceCases),
    [data, openComplianceCases]
  )
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

// ─── Transaction-volume chart card — real stacked-by-capability series ────────────────

/** The volume-chart legend swatches (design lines 30-42). */
function VolumeLegend() {
  return (
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
          <span className="text-[11px] font-semibold text-ink2">{label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * The Transaction-volume card. Wired to the real `txnVolume.stackedSeries` (Phase
 * 6b) — four async branches: loading skeleton / error (shared with the KPI panel,
 * so this only distinguishes loading vs empty vs data) / empty (no txns in range) /
 * data (the stacked-bar silhouette).
 */
function VolumeChartCard({
  data,
  isLoading,
}: {
  data: DashboardSummary | undefined
  isLoading: boolean
}) {
  const bars = useMemo(
    () => (data ? volBarsFrom(data.txnVolume.stackedSeries) : []),
    [data]
  )

  return (
    <FeatureCard>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink">Transaction volume</div>
          <div className="mt-0.5 text-xs text-ink2 tabular-nums">
            by day · stacked by capability
          </div>
        </div>
        <VolumeLegend />
      </div>
      <div className="mt-4">
        {isLoading ? (
          <Skeleton className="h-[180px] rounded-[12px]" />
        ) : bars.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-[12.5px] text-ink3">
            No transactions in this range.
          </div>
        ) : (
          <ChartBars
            bars={bars}
            ariaLabel="Transaction volume by day, stacked by capability"
            showLegend={false}
          />
        )}
      </div>
    </FeatureCard>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────────────

export function OperatorDashboard() {
  const [range, setRange] = useState<RangeId>("24h")

  // The KPI tiles + range switcher are wired to the real composite metrics endpoint.
  const days = RANGE_DAYS[range]
  const metricsRange = useMemo(() => rangeForDays(days), [days])
  const query = useDashboardMetrics(metricsRange)
  const isForbidden =
    query.error instanceof ApiError && query.error.status === 403

  // The System-health card, Live-activity feed, and Open-compliance KPI are wired to
  // the range-independent operational-ops endpoint (a distinct query so a 403 there
  // degrades those panels without hiding the range-scoped KPIs, and vice-versa).
  const opsQuery = useMetricsOps()

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

        {query.isSuccess && (
          <KpiGrid
            data={query.data}
            openComplianceCases={opsQuery.data?.compliance.openCases}
          />
        )}

        {/* ── Volume chart + System health (design lines 29-77) ─────────────────── */}
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
          <VolumeChartCard data={query.data} isLoading={query.isLoading} />

          <SystemHealthCard
            ops={opsQuery.data}
            isLoading={opsQuery.isLoading}
            isError={opsQuery.isError}
          />
        </div>

        {/* ── Attention row — Live activity | (Approvals + Alerts) (lines 79-120) ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LiveActivityCard
            ops={opsQuery.data}
            isLoading={opsQuery.isLoading}
            isError={opsQuery.isError}
          />
          <div className="flex flex-col gap-4">
            <ApprovalsCard />
            <AlertsCard />
          </div>
        </div>
      </div>
    </div>
  )
}
