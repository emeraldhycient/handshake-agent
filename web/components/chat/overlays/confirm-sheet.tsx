"use client"

import { useState, useEffect, useRef } from "react"
import { LockIcon, AlertTriangleIcon, LoaderCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCountdown } from "@/lib/format"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DetailRows } from "@/components/shared/detail-rows"
import { Money } from "@/components/shared/money"
import type { ConfirmSheetProps } from "@/types/components"

/**
 * Shared body subtree for the confirm overlay.
 * Rendered by both the Sheet (mobile) and Dialog (desktop) wrappers —
 * no duplication.
 *
 * The visible title here is purely presentational — Radix reads the title
 * from the sr-only SheetTitle/DialogTitle rendered in the shell above.
 */
function ConfirmBody({
  payload,
  error,
  onConfirm,
  onCancel,
}: {
  payload: NonNullable<ConfirmSheetProps["payload"]>
  error?: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}) {
  const [loading, setLoading] = useState(false)

  // ── Quote-expiry guard ──────────────────────────────────────────────────────
  // The proposal's server-issued expiry (when present) drives a live countdown
  // mirroring QuoteCard, so the user can't enter their PIN against a dead quote.
  // expiresAt is being added to the ConfirmPayload contract (lib/schemas); read
  // it defensively until that lands.
  const expiresAt = (payload as { expiresAt?: string }).expiresAt

  function computeRemaining(): number {
    if (!expiresAt) return Number.POSITIVE_INFINITY
    return Math.max(
      0,
      Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)
    )
  }

  const [remaining, setRemaining] = useState<number>(computeRemaining)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!expiresAt) return
    // Initial remaining is computed by the useState initializer; the interval
    // keeps it ticking. (No synchronous setState in the effect body.)
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
  }, [expiresAt])

  const isExpired = remaining <= 0

  async function handleConfirm() {
    if (loading || isExpired) return
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      // Only reset loading if the component is still showing the confirm sheet.
      // If onConfirm succeeded it transitions to PIN; the sheet will be closed
      // so this set is a no-op but harmless.
      setLoading(false)
    }
  }

  return (
    <div data-testid="confirm-body" className="flex flex-col">
      {/* Title + subtitle — presentational only; AT reads the sr-only shell title */}
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
          {/* Live countdown — mirrors QuoteCard so the user sees the same lock
              window after opening the sheet (scenario finding: buy-amounts). */}
          {expiresAt && (
            <span
              className={cn(
                "rounded-full px-2 py-[2px] text-[11px] font-semibold",
                isExpired
                  ? "bg-muted text-muted-foreground"
                  : "bg-warn-muted text-warn"
              )}
            >
              {isExpired ? "Expired" : `Locked ${formatCountdown(remaining)}`}
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

        {/* Optional: to address block */}
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

      {/* Optional: warn banner */}
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

      {/* Authorization error banner */}
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

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-2">
        {isExpired ? (
          // Expired quote — replace the PIN CTA so the user can never reach PIN
          // entry on a dead quote (server still re-checks as the backstop).
          <Button
            onClick={onCancel}
            disabled
            aria-disabled
            className={cn(
              "w-full cursor-not-allowed gap-2 bg-muted py-4 text-base font-bold text-muted-foreground"
            )}
          >
            Quote expired — request a new one
          </Button>
        ) : (
          <Button
            onClick={() => void handleConfirm()}
            disabled={loading}
            className={cn(
              "w-full gap-2 bg-accent py-4 text-base font-bold text-accent-foreground",
              "hover:bg-accent-deep",
              loading && "cursor-not-allowed opacity-70"
            )}
          >
            {loading ? (
              <LoaderCircleIcon
                className="h-[15px] w-[15px] animate-spin"
                aria-hidden="true"
              />
            ) : (
              <LockIcon className="h-[15px] w-[15px]" aria-hidden="true" />
            )}
            {loading ? "Authorizing…" : payload.cta}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={loading}
          className="w-full text-sm font-semibold text-muted-foreground"
        >
          {isExpired ? "Close" : "Cancel"}
        </Button>
      </div>
    </div>
  )
}

/**
 * ConfirmSheet — renders a bottom Sheet on mobile and a centred Dialog on
 * desktop, sharing a single `ConfirmBody` subtree (no duplication).
 *
 * This component only wires the modal shell to the caller's callbacks —
 * it never executes a transaction. Esc / scrim click routes to `onCancel`
 * via the Sheet/Dialog `onOpenChange` handler.
 */
export function ConfirmSheet({
  open,
  payload,
  density,
  onConfirm,
  onCancel,
  error,
}: ConfirmSheetProps) {
  // Guard: don't render the shell at all when there is nothing to show.
  if (!open || !payload) return null

  if (density === "mobile") {
    return (
      <Sheet
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onCancel()
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={cn(
            "rounded-t-[28px] bg-card-muted px-0 pt-0 pb-8",
            "max-h-[92%] overflow-y-auto"
          )}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-[5px] w-10 rounded-full bg-border" />
          </div>
          {/*
            SheetTitle is required by Radix for a11y. Use the real title text
            in an sr-only element so AT reads it, while the visible title in
            ConfirmBody is purely presentational (no id/aria-labelledby plumbing).
          */}
          <SheetTitle className="sr-only">{payload.title}</SheetTitle>
          <SheetDescription className="sr-only">
            {payload.subtitle}
          </SheetDescription>
          <div className="px-5 pt-1.5">
            <ConfirmBody
              payload={payload}
              error={error}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "w-[430px] max-w-[calc(100%-2rem)] rounded-[22px] bg-card-muted",
          "max-h-[90%] overflow-y-auto"
        )}
      >
        {/*
          DialogTitle required by Radix. Use the real title text in an sr-only
          element so AT announces the modal correctly; the visible title in
          ConfirmBody is presentational (no id/aria-labelledby plumbing needed).
        */}
        <DialogTitle className="sr-only">{payload.title}</DialogTitle>
        <DialogDescription className="sr-only">
          {payload.subtitle}
        </DialogDescription>
        <ConfirmBody
          payload={payload}
          error={error}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  )
}
