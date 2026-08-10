import { cn } from "@/lib/utils"
import type { QrPlaceholderProps } from "@/types"

/**
 * CSS QR code motif ported from prototype lines 230–235.
 * All colours use token classes (bg-foreground, border-foreground, bg-card)
 * in place of the prototype's hex literals (#16261e, #ffffff).
 * The root size is applied via inline style because it is a dynamic numeric prop,
 * not a theme colour — acceptable per the data-exception rule.
 */
export function QrPlaceholder({ size = 150, className }: QrPlaceholderProps) {
  const pad = Math.round(size * 0.08)
  const finderSize = Math.round(size * 0.227)
  const finderBorder = Math.round(size * 0.047)
  const finderRadius = Math.round(size * 0.053)

  return (
    <div
      data-testid="qr"
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-[12px] text-foreground",
        className
      )}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      {/* QR module field — diagonal stripe approximation.
          No bg-foreground here: currentColor resolves to foreground (set on root),
          and transparent gaps reveal bg-card — producing visible dark stripes on light. */}
      <div
        data-testid="qr-module"
        className="h-full w-full rounded-sm opacity-90"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, currentColor 0 4px, transparent 4px 8px)",
          backgroundSize: "8px 8px",
        }}
      />

      {/* Finder square — top-left */}
      <div
        data-testid="qr-finder"
        className="absolute bg-card"
        style={{
          top: pad,
          left: pad,
          width: finderSize,
          height: finderSize,
          border: `${finderBorder}px solid var(--foreground)`,
          borderRadius: finderRadius,
        }}
      />

      {/* Finder square — top-right */}
      <div
        data-testid="qr-finder"
        className="absolute bg-card"
        style={{
          top: pad,
          right: pad,
          width: finderSize,
          height: finderSize,
          border: `${finderBorder}px solid var(--foreground)`,
          borderRadius: finderRadius,
        }}
      />

      {/* Finder square — bottom-left */}
      <div
        data-testid="qr-finder"
        className="absolute bg-card"
        style={{
          bottom: pad,
          left: pad,
          width: finderSize,
          height: finderSize,
          border: `${finderBorder}px solid var(--foreground)`,
          borderRadius: finderRadius,
        }}
      />
    </div>
  )
}
