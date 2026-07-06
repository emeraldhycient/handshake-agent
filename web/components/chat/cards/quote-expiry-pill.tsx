import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/shared/status-pill"
import { formatCountdown } from "@/lib/format"
import type { QuoteExpiryPillProps } from "@/types/chat"

/** Rate-lock countdown badge for quote/swap cards ("Locked mm:ss" / "Expired"). */
export function QuoteExpiryPill({
  remaining,
  isExpired,
  density,
}: QuoteExpiryPillProps) {
  const isMobile = density === "mobile"
  return (
    <StatusPill
      tone={isExpired ? "neutral" : "warn"}
      className={cn(
        "font-semibold",
        isMobile
          ? "px-[9px] py-[3px] text-[11.5px]"
          : "px-2 py-[2px] text-[11px]"
      )}
    >
      {isExpired ? "Expired" : `Locked ${formatCountdown(remaining)}`}
    </StatusPill>
  )
}
