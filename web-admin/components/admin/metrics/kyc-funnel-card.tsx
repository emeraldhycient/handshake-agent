import { MetricsBar } from "@/components/admin/metrics-bar"
import { FeatureCard, CardHeading } from "@/components/admin/feature-card"
import type { MetricsCardProps } from "@/types/components"

/** KYC funnel card — the current population by verification status and by KYC tier. */
export function KycFunnelCard({ data }: MetricsCardProps) {
  const { byStatus, byTier } = data.kycFunnel
  const statusMax = byStatus.reduce((m, s) => Math.max(m, s.count), 0)
  const tierMax = byTier.reduce((m, t) => Math.max(m, t.count), 0)

  return (
    <FeatureCard className="flex flex-col gap-4">
      <CardHeading title="KYC funnel" note="current population" />
      <div>
        <div className="mb-2 text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
          By status
        </div>
        {byStatus.length === 0 ? (
          <p className="text-[12.5px] text-ink3">No users.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {byStatus.map((s) => (
              <MetricsBar
                key={s.status}
                label={s.status}
                value={s.count}
                max={statusMax}
                caption={s.count.toLocaleString()}
              />
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
          By tier
        </div>
        {byTier.length === 0 ? (
          <p className="text-[12.5px] text-ink3">No users.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {byTier.map((t) => (
              <MetricsBar
                key={t.tier}
                label={t.tier}
                value={t.count}
                max={tierMax}
                caption={t.count.toLocaleString()}
              />
            ))}
          </div>
        )}
      </div>
    </FeatureCard>
  )
}
