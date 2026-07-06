"use client"

import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/shared/status-pill"
import { DetailRows } from "@/components/shared/detail-rows"
import { ChatCardShell } from "@/components/chat/cards/chat-card-shell"
import { useSettlementWatcher } from "@/hooks/use-settlement-watcher"
import type { SettlingCardProps } from "@/types/components"
import type { QuoteRow } from "@/lib/schemas"

/**
 * SettlingCard — pure card shown while a sell payout or send withdrawal is in
 * flight (the outbound analogue of PayInCard). No state, no polling — polling
 * lives in SettlingCardLive via the shared useSettlementWatcher hook.
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

  // The SettlingView.txType enum is widened to include "swap" in the contract;
  // read it through a widened local until that lands so swap copy isn't blocked.
  const flow = txType as "sell" | "send" | "swap"

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

  // Failure is the highest-signal state — danger-red, never the calm info palette.
  const statusTone = isCompleted ? "success" : isFailed ? "danger" : "warn"
  const completedLabel =
    flow === "sell" ? "Paid out" : flow === "swap" ? "Swapped" : "Sent"
  const statusLabel = isCompleted
    ? completedLabel
    : isFailed
      ? "Failed"
      : "Processing"

  const eyebrow =
    flow === "sell"
      ? "Bank Payout"
      : flow === "swap"
        ? "Swap"
        : "On-Chain Transfer"

  return (
    <ChatCardShell density={density} desktopShadow className={className}>
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
          {eyebrow}
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
    </ChatCardShell>
  )
}

/**
 * SettlingCardLive — the single settlement watcher for a sell/send/swap. Polls
 * via useSettlementWatcher (which resolves terminal states to the store) and
 * renders the live status.
 */
export function SettlingCardLive({
  transactionId,
  status: initialStatus,
  ...rest
}: SettlingCardProps) {
  const liveStatus = useSettlementWatcher(transactionId, initialStatus)
  return (
    <SettlingCard {...rest} transactionId={transactionId} status={liveStatus} />
  )
}
