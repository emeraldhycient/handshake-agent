"use client"

import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/shared/status-pill"
import { DetailRows } from "@/components/shared/detail-rows"
import { useTransactionStatus } from "@/lib/query/hooks"
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

  const detailRows: QuoteRow[] = [
    ...rows,
    {
      label: txType === "sell" ? "Payout reference" : "Network reference",
      value: reference,
    },
  ]

  const isCompleted = status === "completed"
  const isFailed = status === "failed"

  const statusTone = isCompleted ? "success" : isFailed ? "info" : "warn"
  const statusLabel = isCompleted
    ? txType === "sell"
      ? "Paid out"
      : "Sent"
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
          {txType === "sell" ? "Bank Payout" : "On-Chain Transfer"}
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
          ? "This transfer could not be completed. No funds have left your wallet."
          : isCompleted
            ? txType === "sell"
              ? "The funds have been sent to your bank account."
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
 * SettlingCardLive — polls transaction status via TanStack Query and passes the
 * live status into the pure SettlingCard. Polling stops once the transaction
 * reaches "completed" or "failed".
 */
export function SettlingCardLive({
  transactionId,
  status: initialStatus,
  ...rest
}: SettlingCardProps) {
  const { data } = useTransactionStatus(transactionId, {
    enabled: initialStatus !== "completed" && initialStatus !== "failed",
  })

  const liveStatus =
    (data?.status as SettlingCardProps["status"] | undefined) ?? initialStatus

  return (
    <SettlingCard {...rest} transactionId={transactionId} status={liveStatus} />
  )
}
