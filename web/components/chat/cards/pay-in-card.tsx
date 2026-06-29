"use client"

import { useEffect } from "react"

import { cn } from "@/lib/utils"
import { formatNGN } from "@/lib/format"
import { StatusPill } from "@/components/shared/status-pill"
import { DetailRows } from "@/components/shared/detail-rows"
import { useTransactionStatus } from "@/lib/query/hooks"
import { useChatStore } from "@/lib/store/chat-store"
import type { PayInCardProps } from "@/types/components"
import type { QuoteRow } from "@/lib/schemas"

/**
 * PayInCard — pure presentational card for a bank transfer pay-in.
 * Rendered after executeProposal returns status:"settling" + payment object.
 *
 * Shows the bank account details the user must transfer to, the amount,
 * reference, and a live status pill driven by the `status` prop.
 *
 * No state, no polling — polling lives in PayInCardLive.
 */
export function PayInCard({
  accountNumber,
  bankName,
  providerRef,
  amount,
  status,
  density,
  className,
}: PayInCardProps) {
  const isMobile = density === "mobile"

  const rows: QuoteRow[] = [
    { label: "Account number", value: accountNumber },
    { label: "Bank", value: bankName },
    { label: "Reference", value: providerRef },
    // Product is NGN-only; formatNGN renders "₦20,000.00" consistent with the
    // quote/receipt cards (the `currency` prop is always "NGN").
    { label: "Amount", value: formatNGN(amount) },
  ]

  const isPending = status === "pending" || status === "settling"
  const isCompleted = status === "completed"
  const isFailed = status === "failed"

  const statusTone = isCompleted
    ? "success"
    : isFailed
      ? "info"
      : isPending
        ? "warn"
        : "neutral"

  const statusLabel = isCompleted
    ? "Payment received"
    : isFailed
      ? "Payment failed"
      : "Awaiting transfer"

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
    </div>
  )
}

/**
 * PayInCardLive — the SINGLE settlement watcher (C4). Polls transaction status
 * via the TanStack Query hook (which stops on "completed"/"failed" and unsubscribes
 * on unmount), renders the live status pill, and hands terminal results to the
 * store so it appends the receipt (completed) or surfaces the failure (failed).
 *
 * There is no second poller: the store's setInterval — which polled forever on a
 * failed settlement and swallowed the failure — was removed in favour of this hook.
 */
export function PayInCardLive({
  transactionId,
  status: initialStatus,
  ...rest
}: PayInCardProps) {
  const { data } = useTransactionStatus(transactionId, {
    enabled: initialStatus !== "completed" && initialStatus !== "failed",
  })
  const resolveSettlement = useChatStore((s) => s.resolveSettlement)

  // Derive live status: prefer polled data, fall back to the prop from the store.
  const liveStatus =
    (data?.status as PayInCardProps["status"] | undefined) ?? initialStatus

  // When the poll reaches a terminal status, notify the store. resolveSettlement
  // is idempotent + guarded on the tracked tx, so repeated effect fires are safe.
  useEffect(() => {
    if (data && (data.status === "completed" || data.status === "failed")) {
      resolveSettlement(data)
    }
  }, [data, resolveSettlement])

  return (
    <PayInCard {...rest} transactionId={transactionId} status={liveStatus} />
  )
}
