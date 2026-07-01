"use client"

/**
 * KpiCard — the shared KPI stat tile (design §5 "KPI stat card", lines 903-913). One
 * primitive for every dashboard KPI grid so the hero + normal variants stay
 * consistent. Tile 0 renders the dark-green brand gradient (white ink, amber-on-deep
 * delta chip, muted sub-ink); a normal tile uses the `--card` surface with a
 * success/warn delta chip. Numbers are tabular (`.tnum`).
 */
import { cn } from "@/lib/utils"
import type { KpiCardProps } from "@/types/components"

export function KpiCard({
  label,
  value,
  delta,
  deltaNote,
  hero,
  tone = "success",
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border px-[17px] py-4",
        hero
          ? "border-transparent bg-[linear-gradient(150deg,var(--brand-green)_0%,var(--brand-green-deep)_100%)] text-white"
          : "border-line bg-card text-ink"
      )}
    >
      <div
        className={cn(
          "text-xs font-semibold",
          hero ? "text-on-brand-muted" : "text-ink3"
        )}
      >
        {label}
      </div>
      <div className="mt-1.5 text-[26px] leading-none font-extrabold tracking-[-0.02em] tabular-nums">
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
                  : tone === "warn"
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
                hero ? "text-on-brand-muted" : "text-ink3"
              )}
            >
              {deltaNote}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
