/**
 * MetricsBar — a small token-styled horizontal bar (no chart dependency).
 *
 * Renders value/max as a width-% fill over a muted track. Tokens only
 * (`bg-primary` fill, `bg-muted` track). Exposed to assistive tech via
 * role="img" + an aria-label, so the figure is conveyed without relying on the
 * visual bar alone (root §13.8 — colour is never the only signal).
 */
import type { MetricsBarProps } from "@/types/components"

export function MetricsBar({ label, value, max, caption }: MetricsBarProps) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0
  const pct = max > 0 ? Math.min(100, Math.round((safeValue / max) * 100)) : 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs font-medium text-foreground">
          {label}
        </span>
        {caption && (
          <span className="flex-none text-xs text-muted-foreground tabular-nums">
            {caption}
          </span>
        )}
      </div>
      <div
        role="img"
        aria-label={`${label}: ${caption ?? `${pct}%`}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
