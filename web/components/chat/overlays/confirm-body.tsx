"use client"

import { useState } from "react"
import { AlertTriangleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCountdown } from "@/lib/format"
import { useCountdown } from "@/hooks/use-countdown"
import { DetailRows } from "@/components/shared/detail-rows"
import { Money } from "@/components/shared/money"
import { ConfirmActions } from "@/components/chat/overlays/confirm-actions"
import type { ConfirmBodyProps } from "@/types/chat"

/**
 * Shared body of the confirm overlay — rendered by both the mobile Sheet and
 * desktop Dialog shells (no duplication). Runs a live quote-expiry countdown so
 * the user can't enter their PIN against a dead quote. Never executes: it only
 * wires the caller's confirm/cancel callbacks (root §16, CLAUDE.md §3.1).
 */
export function ConfirmBody({
  payload,
  error,
  onConfirm,
  onCancel,
}: ConfirmBodyProps) {
  const [loading, setLoading] = useState(false)
  // expiresAt is being added to the ConfirmPayload contract — read defensively.
  const expiresAt = (payload as { expiresAt?: string }).expiresAt
  const { secondsLeft, expired: isExpired } = useCountdown(expiresAt)

  async function handleConfirm() {
    if (loading || isExpired) return
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-testid="confirm-body" className="flex flex-col">
      {/* Title + subtitle — presentational; AT reads the sr-only shell title. */}
      <div className="flex flex-col gap-1">
        <span className="text-xl font-extrabold tracking-tight text-foreground">
          {payload.title}
        </span>
        <span className="text-sm text-muted-foreground">
          {payload.subtitle}
        </span>
      </div>

      {/* Hero card */}
      <div className="mt-4 rounded-[18px] border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold tracking-widest text-muted-foreground-subtle uppercase">
            {payload.heroLabel}
          </p>
          {expiresAt && (
            <span
              className={cn(
                "rounded-full px-2 py-[2px] text-[11px] font-semibold",
                isExpired
                  ? "bg-muted text-muted-foreground"
                  : "bg-warn-muted text-warn"
              )}
            >
              {isExpired
                ? "Expired"
                : `Locked ${formatCountdown(secondsLeft ?? 0)}`}
            </span>
          )}
        </div>
        <Money
          as="div"
          value={payload.heroAmount}
          className="mt-0.5 text-3xl font-extrabold tracking-tight text-foreground"
        />
        <p className="mt-0.5 text-sm text-muted-foreground">
          {payload.heroSub}
        </p>

        {payload.toValue && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground-subtle">
              {payload.toLabel}
            </p>
            <p className="mt-0.5 font-mono text-sm leading-relaxed break-all text-foreground">
              {payload.toValue}
            </p>
          </div>
        )}
      </div>

      {payload.warn && (
        <div className="mt-3 flex items-start gap-2.5 rounded-[14px] border border-warn bg-warn-muted p-3">
          <AlertTriangleIcon
            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent-deep"
            aria-hidden="true"
          />
          <span className="text-[13px] leading-relaxed font-medium text-warn-foreground">
            {payload.warn}
          </span>
        </div>
      )}

      {/* Rows + total */}
      <div className="mt-3 flex flex-col gap-2.5 rounded-[18px] border border-border bg-card px-4 py-3.5">
        <DetailRows rows={payload.rows} />
        <div className="h-px bg-border" />
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-bold text-foreground">
            {payload.totalLabel}
          </span>
          <Money
            value={payload.totalValue}
            className="text-lg font-extrabold text-foreground"
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2.5 rounded-[14px] border border-danger bg-danger-muted p-3">
          <AlertTriangleIcon
            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger"
            aria-hidden="true"
          />
          <span className="text-[13px] leading-relaxed font-medium text-danger-foreground">
            {error}
          </span>
        </div>
      )}

      <ConfirmActions
        isExpired={isExpired}
        loading={loading}
        cta={payload.cta}
        onConfirm={() => void handleConfirm()}
        onCancel={onCancel}
      />
    </div>
  )
}
