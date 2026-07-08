import type { DashboardSummary } from "@handshake-agent/contracts"

import { formatMoneyList } from "@/lib/format"
import type { KpiTileProps } from "@/types/components"

/** Format a [0,1] rate as a one-decimal percentage (0.925 → "92.5%"). */
export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/**
 * Derive the four KPI tiles from the composite dashboard summary. Revenue is shown
 * PER-CURRENCY (each with its own symbol), never first-currency-only (#11/#12), and
 * profit (fees + realized spread) is a per-currency footnote (docs §5). Tile 0 is the
 * hero. Pure — the money-math lives here so the grid is presentation.
 */
export function buildKpiTiles(data: DashboardSummary): KpiTileProps[] {
  const { txnVolume, activeUsers, revenue } = data
  const totalTxns = txnVolume.byType.reduce((sum, t) => sum + t.count, 0)
  const revenueValue = formatMoneyList(revenue.totalFeesByCurrency)
  const revenueNote =
    revenue.totalFeesByCurrency.length === 0
      ? "No fee revenue"
      : "fees collected"
  const profitFootnote = `Profit ${formatMoneyList(revenue.totalProfitByCurrency)} (fees + spread)`

  return [
    {
      hero: true,
      label: "Total transactions",
      value: totalTxns.toLocaleString(),
      delta: formatPct(txnVolume.successRate),
      deltaNote: "success rate",
    },
    {
      label: "Success rate",
      value: formatPct(txnVolume.successRate),
      delta: `${revenue.txnCount.toLocaleString()}`,
      deltaNote: "completed",
    },
    {
      label: "Active users",
      value: activeUsers.activeInRange.toLocaleString(),
      delta: `+${activeUsers.newInRange.toLocaleString()}`,
      deltaNote: `new · ${activeUsers.totalUsers.toLocaleString()} total`,
    },
    {
      label: "Revenue (fees)",
      value: revenueValue,
      deltaNote: revenueNote,
      footnote: profitFootnote,
      warn: revenue.totalFeesByCurrency.length === 0,
    },
  ]
}
