"use client"

/**
 * TrendChart — a self-contained SVG line/area chart (go-readiness #7 graphs). No
 * charting library: points are normalized into a fixed 100×40 viewBox and drawn as
 * a `currentColor` line with an optional area fill, so a card sets the hue with a
 * `text-*` class and the chart stretches responsively (non-scaling stroke keeps the
 * line crisp). Presentation only — no data fetching. Empty input → an inline
 * "No data" note (never a blank/degenerate chart).
 */
import { cn } from "@/lib/utils"
import type { TrendChartProps } from "@/types/components"

const VIEW_W = 100
const VIEW_H = 40

export function TrendChart({
  points,
  ariaLabel,
  area = true,
  className,
}: TrendChartProps) {
  if (points.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[80px] items-center justify-center text-[12px] text-ink3",
          className
        )}
      >
        No data in this range.
      </div>
    )
  }

  const values = points.map((p) => p.value)
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const n = points.length

  const coords = points.map((p, i) => {
    const x = n === 1 ? VIEW_W / 2 : (i / (n - 1)) * VIEW_W
    const y = VIEW_H - ((p.value - min) / range) * VIEW_H
    return [x, y] as const
  })

  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ")
  const areaPath = `${linePath} L ${VIEW_W.toFixed(2)} ${VIEW_H.toFixed(2)} L 0.00 ${VIEW_H.toFixed(2)} Z`

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={cn("h-full w-full text-brand-green", className)}
    >
      {area && (
        <path d={areaPath} fill="currentColor" opacity={0.12} stroke="none" />
      )}
      <path
        data-role="line"
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
