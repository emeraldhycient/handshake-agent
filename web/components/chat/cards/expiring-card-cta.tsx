import { cn } from "@/lib/utils"
import type { ExpiringCardCtaProps } from "@/types/chat"

/**
 * Confirm CTA for a rate-locked card: an accent button (disabled + greyed when
 * expired) plus a reassurance/expiry-recovery hint, shown on both densities.
 *
 * Bug 2: a `terminal` state (an already-executed / rejected proposal on reload)
 * overrides both active and expired — the button is disabled and shows the
 * terminal label/tone, so a settled transfer never re-renders a live confirm.
 */
export function ExpiringCardCTA({
  isExpired,
  onConfirm,
  activeLabel,
  expiredLabel,
  activeHint,
  expiredHint,
  density,
  terminal,
}: ExpiringCardCtaProps) {
  const isMobile = density === "mobile"
  const disabled = isExpired || !!terminal
  const label = terminal
    ? terminal.label
    : isExpired
      ? expiredLabel
      : activeLabel
  const hint = terminal ? terminal.hint : isExpired ? expiredHint : activeHint
  return (
    <div className={cn(isMobile ? "px-4 pb-4" : "px-[15px] pb-[15px]")}>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        aria-disabled={disabled}
        className={cn(
          "w-full border-none font-bold",
          "shadow-cta",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          isMobile
            ? "rounded-[14px] py-3.5 text-[15px]"
            : "rounded-[12px] py-3 text-[14px]",
          // Terminal success reads as a completed (green) state, distinct from
          // the greyed expired/cancelled state.
          terminal?.tone === "success"
            ? "bg-success-muted text-success"
            : disabled
              ? "bg-muted text-muted-foreground"
              : "bg-accent text-accent-foreground"
        )}
      >
        {label}
      </button>
      <p
        className={cn(
          "text-center text-muted-foreground-subtle",
          isMobile ? "mt-[9px] text-[11.5px]" : "mt-2 text-[11px]"
        )}
      >
        {hint}
      </p>
    </div>
  )
}
