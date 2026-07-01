"use client"

import { useEffect } from "react"

import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/shared/status-pill"
import { DetailRows } from "@/components/shared/detail-rows"
import { useTransactionStatus } from "@/lib/query/hooks"
import { useChatStore } from "@/lib/store/chat-store"
import type { SettlingCardProps } from "@/types/components"
import type { QuoteRow } from "@/lib/schemas"

/**
 * SettlingCard — pure card shown while a sell payout or send withdrawal is in
 * flight (the outbound analogue of PayInCard). Rendered after executeProposal
 * returns status:"settling" with a payout / onChain reference.
 *
 * No state, no polling — polling lives in SettlingCardLive.
 */
export function SettlingCard({
  txType,
  title,
  subtitle,
  rows,
  reference,
  status,
  density,
  className,
}: SettlingCardProps) {
  const isMobile = density === "mobile"

  // The SettlingView.txType enum is widened to include "swap" in the contract
  // (lib/schemas); until that lands the prop type may not list it, so we read it
  // through a widened local to render swap copy without a stale type blocking it.
  const flow = txType as "sell" | "send" | "swap"

  // The reference is denominated per-flow: bank payout, on-chain transfer, or
  // provider swap. A swap-in-flight must read as a swap, not an on-chain "send".
  const referenceLabel =
    flow === "sell"
      ? "Payout reference"
      : flow === "swap"
        ? "Swap reference"
        : "Network reference"

  const detailRows: QuoteRow[] = [
    ...rows,
    { label: referenceLabel, value: reference },
  ]

  const isCompleted = status === "completed"
  const isFailed = status === "failed"

  // Failure is the highest-signal state — danger-red, never the calm info palette
  // (scenario finding: ui-consistency-states).
  const statusTone = isCompleted ? "success" : isFailed ? "danger" : "warn"
  const completedLabel =
    flow === "sell" ? "Paid out" : flow === "swap" ? "Swapped" : "Sent"
  const statusLabel = isCompleted
    ? completedLabel
    : isFailed
      ? "Failed"
      : "Processing"

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
      {/* Header */}
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
          {flow === "sell"
            ? "Bank Payout"
            : flow === "swap"
              ? "Swap"
              : "On-Chain Transfer"}
        </span>
        <StatusPill
          tone={statusTone}
          className={cn(
            "font-semibold",
            isMobile
              ? "px-[9px] py-[3px] text-[11.5px]"
              : "px-2 py-[2px] text-[11px]"
          )}
        >
          {statusLabel}
        </StatusPill>
      </div>

      {/* Title + subtitle */}
      <p
        className={cn(
          "font-semibold text-foreground",
          isMobile ? "px-4 pt-2 text-[15px]" : "px-[15px] pt-[7px] text-[14px]"
        )}
      >
        {title}
      </p>
      <p
        className={cn(
          "text-muted-foreground",
          isMobile
            ? "px-4 pt-1 pb-3 text-[13px]"
            : "px-[15px] pt-[3px] pb-[11px] text-[12px]"
        )}
      >
        {isFailed
          ? flow === "swap"
            ? "This swap could not be completed. No funds have left your wallet."
            : "This transfer could not be completed. No funds have left your wallet."
          : isCompleted
            ? flow === "sell"
              ? "The funds have been sent to your bank account."
              : flow === "swap"
                ? "Your swap is complete."
                : "Your transfer has been broadcast on-chain."
            : subtitle}
      </p>

      {/* Divider */}
      <div className={cn("h-px bg-border", isMobile ? "mx-4" : "mx-[15px]")} />

      {/* Detail rows */}
      <div
        className={cn(
          isMobile ? "px-4 pt-3 pb-4" : "px-[15px] pt-[11px] pb-[15px]"
        )}
      >
        <DetailRows
          rows={detailRows}
          className={isMobile ? "gap-[9px]" : "gap-2"}
        />
      </div>
    </div>
  )
}

/**
 * SettlingCardLive — the SINGLE settlement watcher for a sell/send (C4). Polls
 * transaction status via the TanStack Query hook (which stops on
 * "completed"/"failed" and unsubscribes on unmount), renders the live status,
 * and hands terminal results to the store so it appends the completion receipt
 * or surfaces the failure. No store setInterval runs alongside it.
 */
export function SettlingCardLive({
  transactionId,
  status: initialStatus,
  ...rest
}: SettlingCardProps) {
  const { data } = useTransactionStatus(transactionId, {
    enabled: initialStatus !== "completed" && initialStatus !== "failed",
  })
  const resolveSettlement = useChatStore((s) => s.resolveSettlement)

  const liveStatus =
    (data?.status as SettlingCardProps["status"] | undefined) ?? initialStatus

  // When the poll reaches a terminal status, notify the store. resolveSettlement
  // is idempotent + guarded on the tracked tx, so repeated effect fires are safe.
  useEffect(() => {
    if (data && (data.status === "completed" || data.status === "failed")) {
      resolveSettlement(data)
    }
  }, [data, resolveSettlement])

  return (
    <SettlingCard {...rest} transactionId={transactionId} status={liveStatus} />
  )
}
