"use client"

/**
 * TransactionDetail — the engine transaction drawer (a right-side Sheet). Opened
 * by the transactions table with a `transactionId`; fetches the full detail via
 * `useTransactionDetail` and renders the lifecycle timeline, the double-entry
 * ledger legs, the engine references (idempotencyKey / processorTxRef /
 * onChainTxHash), the failure reason, and the triage actions.
 *
 * Triage: Mark failed (with a required reason) and Retry are offered only for a
 * `settling` or `failed` transaction. Both are sensitive — we attempt the
 * mutation, and if it 403s with ADMIN_STEP_UP_REQUIRED we open the StepUpDialog
 * and retry after re-auth (`useStepUpRetry`). They never move money directly
 * (§3.1): mark-failed routes through the engine's atomic refund, retry only
 * re-enqueues settlement.
 *
 * Four async branches on the detail query: loading / error / empty / data.
 */
import { useState } from "react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionStatusBadge } from "@/components/admin/transaction-status-badge"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdminMe,
  useMarkFailed,
  useRetrySettlement,
  useTransactionDetail,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { TransactionDetailProps } from "@/types/components"

// Statuses where triage (mark-failed / retry) is meaningful.
const TRIAGEABLE = new Set(["settling", "failed"])

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function TransactionDetail({
  transactionId,
  onOpenChange,
}: TransactionDetailProps) {
  const detail = useTransactionDetail(transactionId)
  const me = useAdminMe()
  const markFailed = useMarkFailed()
  const retry = useRetrySettlement()
  const stepUp = useStepUpRetry()
  const [reason, setReason] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const txn = detail.data

  async function run(action: () => Promise<void>) {
    setLocalError(null)
    try {
      await stepUp.run(action)
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  function onMarkFailed(id: string) {
    if (reason.trim().length === 0) {
      setLocalError("A reason is required to mark a transaction failed.")
      return
    }
    void run(() =>
      markFailed
        .mutateAsync({ id, input: { reason: reason.trim() } })
        .then(() => undefined)
    )
  }

  function onRetry(id: string) {
    void run(() => retry.mutateAsync(id).then(() => undefined))
  }

  const busy = markFailed.isPending || retry.isPending

  return (
    <Sheet open={transactionId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Transaction detail</SheetTitle>
          <SheetDescription>
            {txn ? `${txn.type} · ${txn.id}` : "Loading transaction"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4 pt-0">
          {/* ── Loading ──────────────────────────────────────────────────── */}
          {detail.isLoading && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {detail.isError && (
            <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
              <p className="text-sm font-semibold text-destructive">
                Failed to load this transaction
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Close and try again.
              </p>
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────────────── */}
          {detail.isSuccess && txn && (
            <>
              <Section title="Summary">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <TransactionStatusBadge status={txn.status} />
                  </dd>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="text-foreground">{txn.type}</dd>
                  <dt className="text-muted-foreground">User</dt>
                  <dd className="font-mono text-xs text-foreground">
                    {txn.userId}
                  </dd>
                  <dt className="text-muted-foreground">Idempotency key</dt>
                  <dd className="font-mono text-xs break-all text-foreground">
                    {txn.idempotencyKey}
                  </dd>
                  <dt className="text-muted-foreground">Processor ref</dt>
                  <dd className="font-mono text-xs break-all text-foreground">
                    {txn.processorTxRef ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">On-chain hash</dt>
                  <dd className="font-mono text-xs break-all text-foreground">
                    {txn.onChainTxHash ?? "—"}
                  </dd>
                  {txn.failureReason && (
                    <>
                      <dt className="text-muted-foreground">Failure reason</dt>
                      <dd className="text-destructive">{txn.failureReason}</dd>
                    </>
                  )}
                </dl>
              </Section>

              <Separator />

              <Section title="Timeline">
                {txn.timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No lifecycle events.
                  </p>
                ) : (
                  <ol className="flex flex-col gap-1.5 text-sm">
                    {txn.timeline.map((entry) => (
                      <li
                        key={`${entry.status}-${entry.at}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-foreground">{entry.status}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatDate(entry.at)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              <Separator />

              <Section title="Ledger legs">
                {txn.ledgerLegs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No ledger legs.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>Dir</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {txn.ledgerLegs.map((leg, i) => (
                          <TableRow
                            key={`${leg.accountId}-${leg.postedAt}-${i}`}
                          >
                            <TableCell className="font-mono text-[11px] text-muted-foreground">
                              {leg.accountType}/{leg.accountId.slice(0, 6)}…
                            </TableCell>
                            <TableCell className="text-xs">
                              {leg.direction === "debit" ? "−" : "+"}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {leg.amount} {leg.currency}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                              {leg.balanceAfter}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Section>

              {/* ── Triage (settling / failed only) ──────────────────────── */}
              {TRIAGEABLE.has(txn.status) && (
                <>
                  <Separator />
                  <Section title="Triage">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="txn-fail-reason">
                          Mark-failed reason
                        </Label>
                        <Input
                          id="txn-fail-reason"
                          value={reason}
                          disabled={busy}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Why is this being marked failed?"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => onMarkFailed(txn.id)}
                        >
                          Mark failed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => onRetry(txn.id)}
                        >
                          Retry
                        </Button>
                      </div>
                      {localError && (
                        <p role="alert" className="text-xs text-destructive">
                          {localError}
                        </p>
                      )}
                    </div>
                  </Section>
                </>
              )}
            </>
          )}
        </div>

        <StepUpDialog
          open={stepUp.open}
          mfaEnabled={me.data?.mfaEnabled ?? false}
          onOpenChange={stepUp.setOpen}
          onSuccess={() => {
            void stepUp
              .retry()
              .catch((error) => setLocalError(errorMessage(error)))
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
