import { cn } from "@/lib/utils"
import type { KpiTileProps } from "@/types"

/**
 * KPI stat tile (§5). Tile 0 is the dark-green "hero" — a brand-green→deep
 * gradient with white ink and an amber delta chip; other tiles use the card
 * surface with a success/warn muted delta chip.
 */
export function KpiTile({
  label,
  value,
  delta,
  deltaNote,
  footnote,
  hero = false,
  warn = false,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-[16px_17px]",
        hero
          ? "border-transparent bg-[linear-gradient(150deg,var(--brand-green)_0%,var(--brand-green-deep)_100%)] text-white"
          : "border-line bg-card text-ink"
      )}
    >
      <div
        className={cn(
          "text-xs font-semibold",
          hero ? "text-on-brand-muted" : "text-ink2"
        )}
      >
        {label}
      </div>
      <div className="mt-1.5 text-[26px] leading-none font-extrabold tracking-tight tabular-nums">
        {value}
      </div>
      {(delta || deltaNote) && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {delta && (
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[11px] font-bold",
                hero
                  ? "bg-brand-amber text-brand-green-deep"
                  : warn
                    ? "bg-swn text-twn"
                    : "bg-sok text-tok"
              )}
            >
              {delta}
            </span>
          )}
          {deltaNote && (
            <span
              className={cn(
                "text-[11px]",
                hero ? "text-on-brand-muted" : "text-ink2"
              )}
            >
              {deltaNote}
            </span>
          )}
        </div>
      )}
      {footnote && (
        <div
          className={cn(
            "mt-2 text-[10.5px] leading-snug",
            hero ? "text-on-brand-muted" : "text-ink3"
          )}
        >
          {footnote}
        </div>
      )}
    </div>
  )
}
