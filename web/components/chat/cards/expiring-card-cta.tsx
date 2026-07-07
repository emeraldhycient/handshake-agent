import { cn } from "@/lib/utils"
import type { ExpiringCardCtaProps } from "@/types/chat"

/**
 * Confirm CTA for a rate-locked card: an accent button (disabled + greyed when
 * expired) plus a reassurance/expiry-recovery hint, shown on both densities.
 */
export function ExpiringCardCTA({
  isExpired,
  onConfirm,
  activeLabel,
  expiredLabel,
  activeHint,
  expiredHint,
  density,
}: ExpiringCardCtaProps) {
  const isMobile = density === "mobile"
  return (
    <div className={cn(isMobile ? "px-4 pb-4" : "px-[15px] pb-[15px]")}>
      <button
        type="button"
        onClick={onConfirm}
        disabled={isExpired}
        aria-disabled={isExpired}
        className={cn(
          "w-full cursor-pointer border-none font-bold",
          "shadow-cta",
          isMobile
            ? "rounded-[14px] py-3.5 text-[15px]"
            : "rounded-[12px] py-3 text-[14px]",
          isExpired
            ? "cursor-not-allowed bg-muted text-muted-foreground"
            : "bg-accent text-accent-foreground"
        )}
      >
        {isExpired ? expiredLabel : activeLabel}
      </button>
      <p
        className={cn(
          "text-center text-muted-foreground-subtle",
          isMobile ? "mt-[9px] text-[11.5px]" : "mt-2 text-[11px]"
        )}
      >
        {isExpired ? expiredHint : activeHint}
      </p>
    </div>
  )
}
