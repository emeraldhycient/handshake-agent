import { Switch } from "@/components/ui/switch"
import type { PreferenceRowProps } from "@/types/components"

/**
 * One notification-preference toggle row (markup line 8) — label/desc + the shared
 * `Switch` primitive. Controlled by the derived `checked`; flipping it fires
 * `onToggle(next)` (which PATCHes the full preference set).
 */
export function PreferenceRow({ row, checked, onToggle }: PreferenceRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[12px]">
      <div>
        <div className="text-[12.5px] font-bold text-ink">{row.label}</div>
        <div className="text-[11px] text-ink3">{row.desc}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={row.label}
      />
    </div>
  )
}
