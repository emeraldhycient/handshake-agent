"use client"

import { cn } from "@/lib/utils"
import { useWebhookMetrics } from "@/lib/query/hooks"

/** The metrics strip — in-flight depth / failed / dead, from `useWebhookMetrics()`. */
export function WebhookMetricsStrip() {
  const metrics = useWebhookMetrics()
  if (!metrics.isSuccess) return null

  const cells: { label: string; value: number; danger?: boolean }[] = [
    { label: "In-flight", value: metrics.data.depth },
    {
      label: "Failed",
      value: metrics.data.failed,
      danger: metrics.data.failed > 0,
    },
    { label: "Dead", value: metrics.data.dead, danger: metrics.data.dead > 0 },
  ]

  return (
    <div className="mb-4 flex flex-wrap gap-2.5">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-[12px] border border-line bg-card px-4 py-2.5"
        >
          <div className="text-[10px] font-bold tracking-[0.06em] text-ink3 uppercase">
            {c.label}
          </div>
          <div
            className={cn(
              "text-lg font-extrabold tabular-nums",
              c.danger ? "text-tdn" : "text-ink"
            )}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}
