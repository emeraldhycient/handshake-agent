"use client"

import { cn } from "@/lib/utils"
import { formatFiat } from "@/lib/format"
import { StatusPill } from "@/components/shared/status-pill"
import { DetailRows } from "@/components/shared/detail-rows"
import { ChatCardShell } from "@/components/chat/cards/chat-card-shell"
import { useSettlementWatcher } from "@/hooks/use-settlement-watcher"
import type { PayInCardProps } from "@/types/components"
import type { QuoteRow } from "@/lib/schemas"

/**
 * PayInCard — pure presentational card for a bank-transfer pay-in. Shows the
 * account to transfer to, amount, reference, and a live status pill from the
 * `status` prop. No state, no polling — polling lives in PayInCardLive via the
 * shared useSettlementWatcher hook.
 */
export function PayInCard({
  accountNumber,
  bankName,
  providerRef,
  amount,
  currency,
  status,
  density,
  className,
}: PayInCardProps) {
  const isMobile = density === "mobile"

  const rows: QuoteRow[] = [
    { label: "Account number", value: accountNumber },
    { label: "Bank", value: bankName },
    { label: "Reference", value: providerRef },
    // Symbol is driven by the payment's currency — never hardcode ₦ (§3.6).
    { label: "Amount", value: formatFiat(amount, currency) },
  ]

  const isPending = status === "pending" || status === "settling"
  const isCompleted = status === "completed"
  const isFailed = status === "failed"

  // Failure is the highest-signal state — always danger-red, never info/neutral.
  const statusTone = isCompleted
    ? "success"
    : isFailed
      ? "danger"
      : isPending
        ? "warn"
        : "neutral"

  const statusLabel = isCompleted
    ? "Payment received"
    : isFailed
      ? "Payment failed"
      : "Awaiting transfer"

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
          Bank Transfer
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

      {/* Instruction */}
      <p
        className={cn(
          "text-muted-foreground",
          isMobile
            ? "px-4 pt-2 pb-3 text-[13px]"
            : "px-[15px] pt-[7px] pb-[11px] text-[12px]"
        )}
      >
        {isCompleted
          ? "Your payment has been received. Your order is being processed."
          : isFailed
            ? "Payment was not received. Please contact support."
            : "Transfer the exact amount below to the account shown. Include the reference."}
      </p>

      {/* Divider */}
      <div className={cn("h-px bg-border", isMobile ? "mx-4" : "mx-[15px]")} />

      {/* Detail rows */}
      <div
        className={cn(
          isMobile ? "px-4 pt-3 pb-4" : "px-[15px] pt-[11px] pb-[15px]"
        )}
      >
        <DetailRows rows={rows} className={isMobile ? "gap-[9px]" : "gap-2"} />
      </div>
    </ChatCardShell>
  )
}

/**
 * PayInCardLive — the single settlement watcher for a pay-in. Polls via
 * useSettlementWatcher (resolving terminal states to the store) and renders the
 * live status pill.
 */
export function PayInCardLive({
  transactionId,
  status: initialStatus,
  ...rest
}: PayInCardProps) {
  const liveStatus = useSettlementWatcher(transactionId, initialStatus)
  return (
    <PayInCard {...rest} transactionId={transactionId} status={liveStatus} />
  )
}
