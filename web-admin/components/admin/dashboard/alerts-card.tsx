"use client"

import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { FeatureCard } from "@/components/admin/feature-card"
import {
  useOperatorAlerts,
  type AdminAlert,
} from "@/components/admin/use-operator-alerts"

// Icon-chip token per alert tone (status semantic, never colour alone). Lives here
// (not constants/) because it keys off the components-layer `AdminAlert` type.
const ALERT_TONE_CHIP: Record<AdminAlert["tone"], string> = {
  danger: "bg-[color:var(--danger-muted)] text-[color:var(--destructive)]",
  warn: "bg-[color:var(--warn-muted)] text-[color:var(--warn)]",
  info: "bg-[color:var(--info-muted)] text-[color:var(--info)]",
}

/**
 * Alerts card — LIVE alerts from the same source hooks as the topbar bell (shared
 * `useOperatorAlerts`), never a hardcoded list. Empty = "All clear".
 */
export function AlertsCard() {
  const router = useRouter()
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
