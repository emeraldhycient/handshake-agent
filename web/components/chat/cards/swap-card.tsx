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
import type { SwapCardProps } from "@/types"

/** Human ETA for a swap, e.g. "~2 min" / "~45 sec" / "instant". */
function formatEta(sec: number): string {
  if (sec <= 0) return "instant"
  if (sec < 60) return `~${sec} sec`
  return `~${Math.ceil(sec / 60)} min`
}

/**
 * SwapCard — chat message card for a live crypto-to-crypto swap proposal.
 * Orchestrator mirroring QuoteCard (shell + expiry pill + expiring CTA). The FX
 * spread is NEVER surfaced as a line item (CLAUDE.md §3.1).
 */
export function SwapCard({
  fromAsset,
  toAsset,
  fromAmount,
  toAmount,
  rate,
  networkFee,
  transactionFee,
  estimatedArrivalSec,
  expiresAt,
  lockSeconds,
  proposalStatus,
  density,
  onConfirm,
  className,
  ...rest
}: SwapCardProps) {
  const isMobile = density === "mobile"
  const { remaining, isExpired } = useQuoteCountdown(expiresAt, lockSeconds)
  // Bug 2: a reloaded executed/rejected swap proposal renders terminal.
  const terminal = proposalTerminalState(proposalStatus)

  // Network gas is paid in the chain's NATIVE asset (TRX on TRON), not fromAsset.
  // Read the fee denomination defensively until it lands on the SwapView contract.
  const feeAsset = (rest as { feeAsset?: string }).feeAsset?.trim() || fromAsset

  const rows = [
    { label: "You swap", value: `${fromAmount} ${fromAsset}` },
    { label: "Rate", value: `1 ${fromAsset} = ${rate} ${toAsset}` },
    { label: "Network fee", value: `${networkFee} ${feeAsset}` },
    { label: "Transaction fee", value: `${transactionFee} ${feeAsset}` },
    { label: "Estimated arrival", value: formatEta(estimatedArrivalSec) },
  ]

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
          {fromAsset} → {toAsset}
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
          value={`${toAmount} ${toAsset}`}
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
          You receive
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
          Total debit
        </span>
        <Money
          value={`${fromAmount} ${fromAsset}`}
          className={cn(
            "font-extrabold text-foreground",
            isMobile ? "text-[16px]" : "text-[15px]"
          )}
        />
      </div>

      {/* Fee reconciliation note — the headline debit is exactly fromAmount of
          fromAsset; fees come out of the received amount, not on top. */}
      <p
        className={cn(
          "text-muted-foreground-subtle",
          isMobile
            ? "px-4 pb-1 text-[11.5px]"
            : "px-[15px] pb-[3px] text-[11px]"
        )}
      >
        Fees are deducted from the amount you receive, not from this debit.
      </p>

      <ExpiringCardCTA
        isExpired={isExpired}
        onConfirm={onConfirm}
        activeLabel="Review & confirm"
        expiredLabel="Quote expired"
        activeHint={`Rate locked ${formatCountdown(remaining)} · No hidden fees`}
        expiredHint="Request a new swap to continue"
        density={density}
        terminal={terminal}
      />
    </ChatCardShell>
  )
}
