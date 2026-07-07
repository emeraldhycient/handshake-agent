import { usageBar } from "@/lib/users/user-detail"
import type { UdVelocityBarProps } from "@/types/components"

/** One labelled velocity bar (used / cap + a clamped, usage-tinted progress track). */
export function VelocityBar({ label, used, cap, pct }: UdVelocityBarProps) {
  return (
    <div className="mb-[15px]">
      <div className="mb-1.5 flex justify-between">
        <span className="text-xs font-semibold text-ink2">{label}</span>
        <span className="font-mono text-[11.5px] font-bold text-ink2 tabular-nums">
          {used} / {cap}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-md bg-card2">
        <div
          className="h-full rounded-md"
          style={{ width: pct, background: usageBar(pct) }}
        />
      </div>
    </div>
  )
}
