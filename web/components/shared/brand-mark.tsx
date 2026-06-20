import { cn } from "@/lib/utils"
import type { BrandMarkProps } from "@/types/components"

// ─── Constants ──────────────────────────────────────────────────────────────

/** Blade angles (deg) of the spark sunburst — 12 evenly-spaced radiating blades. */
const SPARK_BLADES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

/**
 * Geometry ratios (relative to outer size), unifying the prior inline marks into
 * one canonical squircle. Note: kyc-summary previously used a rounder `rounded-xl`
 * corner (a near-circle on its 36px box); it now matches the other marks here.
 */
const OUTER_RADIUS_RATIO = 0.31
const CENTRE_SIZE_RATIO = 0.38
const CENTRE_RADIUS_RATIO = 0.12
const SPARK_SIZE_RATIO = 0.52

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Canonical Handshake brand mark: the orange squircle with a dark centre.
 *
 *  - `variant="default"` — static dark square (the standing logo).
 *  - `variant="spark"`   — animated rotating sunburst (Claude-style), for
 *    agent-thinking states and the splash screen. Honors `prefers-reduced-motion`
 *    via the `motion-safe:` variant — the spark renders static when motion is off.
 *
 * Decorative by default (`aria-hidden`); pass `ariaLabel` to expose it as an image.
 */
export function BrandMark({
  variant = "default",
  size = 42,
  ariaLabel,
  className,
}: BrandMarkProps) {
  const a11y = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": true }

  return (
    <div
      {...a11y}
      className={cn(
        "flex flex-none items-center justify-center",
        "[background:linear-gradient(150deg,var(--accent)_0%,var(--accent-deep)_100%)]",
        className
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * OUTER_RADIUS_RATIO),
      }}
    >
      {variant === "default" ? (
        <div
          className="bg-primary-deep"
          style={{
            width: Math.round(size * CENTRE_SIZE_RATIO),
            height: Math.round(size * CENTRE_SIZE_RATIO),
            borderRadius: Math.round(size * CENTRE_RADIUS_RATIO),
          }}
        />
      ) : (
        <div className="flex items-center justify-center motion-safe:animate-hs-spark-breathe">
          <svg
            data-testid="brand-spark"
            viewBox="0 0 100 100"
            aria-hidden="true"
            className="origin-center text-primary-deep motion-safe:animate-hs-spark-spin"
            style={{
              width: Math.round(size * SPARK_SIZE_RATIO),
              height: Math.round(size * SPARK_SIZE_RATIO),
            }}
          >
            <g fill="currentColor">
              {SPARK_BLADES.map((deg) => (
                <rect
                  key={deg}
                  x="45.5"
                  y="7"
                  width="9"
                  height="43"
                  rx="4.5"
                  transform={`rotate(${deg} 50 50)`}
                />
              ))}
            </g>
          </svg>
        </div>
      )}
    </div>
  )
}
