"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Money } from "@/components/shared/money"
import { DetailRows } from "@/components/shared/detail-rows"
import { StatusPill } from "@/components/shared/status-pill"
import { formatCountdown } from "@/lib/format"
import type { SwapCardProps } from "@/types/components"

/**
 * SwapCard — chat message card for a live crypto-to-crypto swap proposal.
 *
 * Shows fromAsset → toAsset, fromAmount / toAmount, effective rate,
 * network fee, transaction fee, and estimated arrival time.
 *
 * FX spread is NEVER surfaced as a line item (CLAUDE.md §3.1 / execute-swap.tool.ts).
 *
 * Live countdown: driven from `expiresAt` (ISO string from the server)
 * with fallback to `lockSeconds` for the offline/mock flow.
 * At 0 seconds: badge shows "Expired" and the CTA is disabled.
 *
 * Mirrors QuoteCard styling — tokens only, no hex literals, no data fetching.
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
  density,
  onConfirm,
  className,
  ...rest
}: SwapCardProps) {
  const isMobile = density === "mobile"

  // Network gas is paid in the chain's NATIVE asset (TRX on TRON), not fromAsset.
  // The fee denomination is being added to the SwapView contract (lib/schemas);
  // until that lands, read it defensively and fall back to fromAsset.
  const feeAsset = (rest as { feeAsset?: string }).feeAsset?.trim() || fromAsset

  // ── Live countdown ─────────────────────────────────────────────────────────
  function computeRemaining(): number {
    if (expiresAt) {
      return Math.max(
        0,
        Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)
      )
    }
    return Math.max(0, lockSeconds)
  }

  const [remaining, setRemaining] = useState<number>(computeRemaining)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!expiresAt && lockSeconds <= 0) return

    intervalRef.current = setInterval(() => {
      setRemaining(computeRemaining())
    }, 1000)

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, lockSeconds])

  const isExpired = remaining <= 0
  const countdownLabel = isExpired
    ? "Expired"
    : `Locked ${formatCountdown(remaining)}`

  // ── ETA display ────────────────────────────────────────────────────────────
  // Format estimatedArrivalSec as a human-readable string, e.g. "~2 min" or "~45 sec".
  function formatEta(sec: number): string {
    if (sec <= 0) return "instant"
    if (sec < 60) return `~${sec} sec`
    const mins = Math.ceil(sec / 60)
    return `~${mins} min`
  }

  // ── Detail rows (no spread line) ──────────────────────────────────────────
  const rows = [
    { label: "You swap", value: `${fromAmount} ${fromAsset}` },
    {
      label: "Rate",
      value: `1 ${fromAsset} = ${rate} ${toAsset}`,
    },
    { label: "Network fee", value: `${networkFee} ${feeAsset}` },
    { label: "Transaction fee", value: `${transactionFee} ${feeAsset}` },
    { label: "Estimated arrival", value: formatEta(estimatedArrivalSec) },
  ]

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-card"
          : "w-[92%] rounded-[16px] shadow-[0_4px_14px_oklch(0.244_0.024_162_/_0.06)]",
        className
      )}
    >
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
        <StatusPill
          tone={isExpired ? "neutral" : "warn"}
          className={cn(
            "font-semibold",
            isMobile
              ? "px-[9px] py-[3px] text-[11.5px]"
              : "px-2 py-[2px] text-[11px]"
          )}
        >
          {countdownLabel}
        </StatusPill>
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

      {/* Divider */}
      <div className={cn("h-px bg-border", isMobile ? "mx-4" : "mx-[15px]")} />

      {/* Detail rows */}
      <div
        className={cn(
          isMobile ? "px-4 pt-3 pb-1" : "px-[15px] pt-[11px] pb-[3px]"
        )}
      >
        <DetailRows rows={rows} className={isMobile ? "gap-[9px]" : "gap-2"} />
      </div>

      {/* Divider */}
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
          fromAsset (what the engine reserves); fees come out of the received
          amount, not on top, so the user can reconcile the total. */}
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

      {/* CTA */}
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
          {isExpired ? "Quote expired" : "Review & confirm"}
        </button>
        {/* Reassurance / expiry-recovery hint — shown on BOTH densities for
            parity with QuoteCard (scenario finding: ui-consistency-states). */}
        <p
          className={cn(
            "text-center text-muted-foreground-subtle",
            isMobile ? "mt-[9px] text-[11.5px]" : "mt-2 text-[11px]"
          )}
        >
          {isExpired
            ? "Request a new swap to continue"
            : `Rate locked ${formatCountdown(remaining)} · No hidden fees`}
        </p>
      </div>
    </div>
  )
}
