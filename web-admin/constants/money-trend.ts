import type { MoneyMetric } from "@/types/components"

/** The three money metrics the trend card can plot (segmented toggle order). */
export const MONEY_METRICS: readonly { key: MoneyMetric; label: string }[] = [
  { key: "gmv", label: "GMV" },
  { key: "revenue", label: "Revenue" },
  { key: "profit", label: "Profit" },
]
