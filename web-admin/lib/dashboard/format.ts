import type {
  ActivityEvent,
  DashboardSummary,
  ProviderHealth,
} from "@handshake-agent/contracts"

import { formatMoneyList } from "@/lib/format"
import {
  ACTIVITY_STYLE,
  MONTHS,
  PENDING_KYC_STATUSES,
  STATUS_STYLE,
} from "@/constants/dashboard"
import type {
  ChartBar,
  DashboardActivityItem,
  DashboardHealthRow,
  DashboardKpi,
} from "@/types/components"

/** `f()` — design integer formatter (vDash line 438): `en-NG` grouping, no decimals. */
export function fmtInt(n: number): string {
  return Number(n).toLocaleString("en-NG")
}

/**
 * Derive the eight KPI tiles from the real composite summary. Seven are backed by the
 * composite metrics contract (including GMV); the eighth (Open compliance cases) is
 * sourced from the ops endpoint's open (flagged + under_review) count, or "—" while
 * that read is still loading / forbidden.
 */
export function deriveKpis(
  data: DashboardSummary,
  openComplianceCases: number | undefined
): readonly DashboardKpi[] {
  const { txnVolume, gmv, revenue, kycFunnel, activeUsers } = data
  const totalTxns = txnVolume.byType.reduce((sum, t) => sum + t.count, 0)
  const failedTxns = txnVolume.byType.reduce((sum, t) => sum + t.failed, 0)
  // Stuck = in-flight (pending/validating/confirmed/settling) per the same
  // definition as the sidebar stuck badge, so the two agree (Phase 8 drift fix).
  const stuckTxns = txnVolume.byType.reduce((sum, t) => sum + t.stuck, 0)
  const pendingKyc = kycFunnel.byStatus
    .filter((s) => PENDING_KYC_STATUSES.has(s.status))
    .reduce((sum, s) => sum + s.count, 0)
  // Money tiles show EVERY currency (each with its own symbol via formatFiat),
  // never the first-currency-only or a cross-currency sum (go-readiness #11/#12).
  const revenueValue = formatMoneyList(revenue.totalFeesByCurrency)
  // Profit = fees + realized bid-ask spread, DERIVED per completed buy/sell (docs §5).
  const profitValue = formatMoneyList(revenue.totalProfitByCurrency)
  const profitNote =
    revenue.totalSpreadByCurrency.length > 0
      ? `${formatMoneyList(revenue.totalSpreadByCurrency)} spread`
      : "fees + spread"
  const gmvValue = formatMoneyList(gmv.totalByCurrency)

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
      deltaNote: "gross",
    },
    // Revenue: complete processing fees (buy + sell), derived from the Quote.
    {
      label: "Revenue (fees)",
      value: revenueValue,
      delta: `${revenue.txnCount.toLocaleString()}`,
      deltaNote: "fees",
    },
    // Profit: fees + realized spread margin (derived per completed buy/sell).
    {
      label: "Profit",
      value: profitValue,
      delta: `${revenue.txnCount.toLocaleString()}`,
      deltaNote: profitNote,
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
        openComplianceCases === undefined ? "—" : fmtInt(openComplianceCases),
      delta: openComplianceCases === undefined ? "—" : "open",
      deltaNote: "flagged + review",
      tone: "warn",
    },
  ]
}

/** Short "MMM D" axis label for a YYYY-MM-DD bucket date (UTC, locale-independent). */
export function bucketLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-")
  const monthName = MONTHS[Number(month) - 1] ?? month
  return `${monthName} ${Number(day)}`
}

/** Map the real per-day stacked series onto the ChartBars segment shape. */
export function volBarsFrom(
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

/** Map one contract provider-health row onto the design's HealthRow view shape. */
export function healthRowFrom(provider: ProviderHealth): DashboardHealthRow {
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

/**
 * Compact relative-time label ("2m" / "3h" / "5d") from an ISO timestamp. Distinct
 * from the Users-directory `relativeTime` (that one suffixes "ago" and handles null).
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const deltaMs = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Map one contract activity event onto the design's ActivityItem view shape. */
export function activityItemFrom(event: ActivityEvent): DashboardActivityItem {
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
