import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/shared/status-pill"
import { formatCountdown } from "@/lib/format"
import type { QuoteExpiryPillProps } from "@/types/chat"

/**
 * Rate-lock countdown badge for quote/swap cards ("Locked mm:ss" / "Expired").
 * Bug 2: a `terminal` state (executed/rejected proposal on reload) shows the
 * terminal label/tone instead of the countdown, so the header never contradicts
 * a completed card's body.
 */
export function QuoteExpiryPill({
  remaining,
  isExpired,
  density,
  terminal,
}: QuoteExpiryPillProps) {
  const isMobile = density === "mobile"
  const tone = terminal ? terminal.tone : isExpired ? "neutral" : "warn"
  const label = terminal
    ? terminal.label
    : isExpired
      ? "Expired"
      : `Locked ${formatCountdown(remaining)}`
  return (
    <StatusPill
      tone={tone}
      className={cn(
        "font-semibold",
        isMobile
          ? "px-[9px] py-[3px] text-[11.5px]"
          : "px-2 py-[2px] text-[11px]"
      )}
    >
      {label}
    </StatusPill>
  )
}
