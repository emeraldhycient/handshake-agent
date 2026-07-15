"use client"

import { cn } from "@/lib/utils"
import { Money } from "@/components/shared/money"
import { DetailRows } from "@/components/shared/detail-rows"
import { ChatCardShell } from "@/components/chat/cards/chat-card-shell"
import { QuoteExpiryPill } from "@/components/chat/cards/quote-expiry-pill"
import { ExpiringCardCTA } from "@/components/chat/cards/expiring-card-cta"
import { useQuoteCountdown } from "@/hooks/use-quote-countdown"
import { formatCountdown } from "@/lib/format"
import { proposalTerminalState } from "@/lib/chat/proposal-terminal"
import type { QuoteCardProps } from "@/types/components"

/**
 * QuoteCard — chat message card for a crypto buy/send/swap quote. Orchestrator:
 * runs the live countdown and composes the shell, the expiry pill, the quoted
 * amounts, and the expiring CTA (root §16). density controls sizing only.
 */
export function QuoteCard({
  receiveAmt,
  receiveSub,
  rows,
  totalLabel,
  totalValue,
  lockSeconds,
  expiresAt,
  proposalStatus,
  density,
  onConfirm,
  className,
}: QuoteCardProps) {
  const isMobile = density === "mobile"
  const { remaining, isExpired } = useQuoteCountdown(expiresAt, lockSeconds)
  // Bug 2: an already-executed / rejected proposal (only present on a reloaded
  // card) renders a terminal, non-actionable state instead of a live quote.
  const terminal = proposalTerminalState(proposalStatus)

  return (
    <ChatCardShell density={density} desktopShadow className={className}>
      {/* Header: eyebrow + lock badge */}
      <div
        className={cn(
          "flex items-center justify-between",
          isMobile ? "px-4 pt-3.5" : "px-[15px] pt-[13px]"
        )}
      >
        <span
          className={cn(
            "font-bold tracking-widest text-muted-foreground-subtle uppercase",
            isMobile ? "text-[12px]" : "text-[11px]"
          )}
        >
          Quote
        </span>
        <QuoteExpiryPill
          remaining={remaining}
          isExpired={isExpired}
          density={density}
          terminal={terminal}
        />
      </div>

      {/* Receive amount */}
      <div
        className={cn(
          isMobile ? "px-4 pt-2 pb-3.5" : "px-[15px] pt-[7px] pb-0"
        )}
      >
        <Money
          value={receiveAmt}
          as="div"
          className={cn(
            "font-extrabold tracking-tight text-foreground",
            isMobile ? "text-[30px]" : "text-[26px]"
          )}
        />
        <p
          className={cn(
            "mt-[1px] text-muted-foreground",
            isMobile ? "text-[13px]" : "text-[12px]"
          )}
        >
          {receiveSub}
        </p>
      </div>

      <div className={cn("h-px bg-border", isMobile ? "mx-4" : "mx-[15px]")} />

      {/* Detail rows */}
      <div
        className={cn(
          isMobile ? "px-4 pt-3 pb-1" : "px-[15px] pt-[11px] pb-[3px]"
        )}
      >
        <DetailRows rows={rows} className={isMobile ? "gap-[9px]" : "gap-2"} />
      </div>

      <div
        className={cn(
          "h-px bg-border",
          isMobile ? "mx-4 mt-3" : "mx-[15px] mt-[11px]"
        )}
      />

      {/* Total row */}
      <div
        className={cn(
          "flex items-baseline justify-between",
          isMobile ? "px-4 py-[13px]" : "px-[15px] py-3"
        )}
      >
        <span
          className={cn(
            "font-bold text-foreground",
            isMobile ? "text-[14px]" : "text-[13px]"
          )}
        >
          {totalLabel}
        </span>
        <Money
          value={totalValue}
          className={cn(
            "font-extrabold text-foreground",
            isMobile ? "text-[16px]" : "text-[15px]"
          )}
        />
      </div>

      <ExpiringCardCTA
        isExpired={isExpired}
        onConfirm={onConfirm}
        activeLabel="Review & confirm"
        expiredLabel="Quote expired"
        activeHint={`Rate locked ${formatCountdown(remaining)} · No hidden fees`}
        expiredHint="Request a new quote to continue"
        density={density}
        terminal={terminal}
      />
    </ChatCardShell>
  )
}
