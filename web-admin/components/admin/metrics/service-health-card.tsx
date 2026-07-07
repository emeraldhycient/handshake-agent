import { MetricsBar } from "@/components/admin/metrics-bar"
import { FeatureCard, CardHeading } from "@/components/admin/feature-card"
import { formatPct } from "@/lib/metrics/kpis"
import type { MetricsCardProps } from "@/types/components"

/** Service-health card — a success-rate bar per service with total/completed/failed counts. */
export function ServiceHealthCard({ data }: MetricsCardProps) {
  const { services } = data.serviceHealth

  return (
    <FeatureCard>
      <div className="mb-3.5">
        <CardHeading title="Service health" note="success rate by service" />
      </div>
      {services.length === 0 ? (
        <p className="text-[12.5px] text-ink3">No service activity.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {services.map((s) => (
            <div
              key={s.service}
              className="flex flex-col gap-2 border-b border-line2 pb-3 last:border-0 last:pb-0"
            >
              <MetricsBar
                label={s.service}
                value={s.successRate}
                max={1}
                caption={formatPct(s.successRate)}
              />
              <div className="flex gap-4 text-[10.5px] text-ink3 tabular-nums">
                <span>{s.total.toLocaleString()} total</span>
                <span className="text-tok">
                  {s.completed.toLocaleString()} completed
                </span>
                <span className="text-tdn">
                  {s.failed.toLocaleString()} failed
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </FeatureCard>
  )
}
