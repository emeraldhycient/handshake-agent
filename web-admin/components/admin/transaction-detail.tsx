"use client"

/**
 * TransactionDetail — the engine transaction drawer (a right-side Sheet). Opened
 * by the transactions table with a `transactionId`; fetches the full detail via
 * `useTransactionDetail` and renders the itemized parameters, the double-entry
 * ledger legs, the engine-state timeline (vertical stepper), the provider
 * references (idempotencyKey / processorTxRef / onChainTxHash, copyable), the
 * failure reason, and the triage actions.
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import {
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  InfoIcon,
  XIcon,
} from "lucide-react"
import type {
  AdminTxnDetail,
  AdminTxnTimelineEntry,
} from "@handshake-agent/contracts"
import type { TransactionDetailProps } from "@/types/components"

// Statuses where triage (mark-failed / retry) is meaningful.
const TRIAGEABLE = new Set(["settling", "failed"])

// A card panel matching the design's rounded-16 / 1px-line surface (§5).
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-5">
      {children}
    </div>
  )
}

// Card title = 13px/800 with an optional muted "· note" suffix (§5).
function PanelTitle({
  children,
  note,
}: {
  children: React.ReactNode
  note?: string
}) {
  return (
    <h3 className="mb-3 text-[13px] font-extrabold text-ink">
      {children}
      {note && <span className="font-semibold text-ink3"> · {note}</span>}
    </h3>
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

// A label + monospace value row with a copy button (provider references, §6.9).
function ReferenceRow({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  const present = Boolean(value)
  return (
    <div className="flex items-center gap-2.5 border-b border-line2 py-2.5 last:border-b-0">
      <span className="shrink-0 rounded-[6px] bg-card2 px-2 py-0.5 text-[10.5px] font-bold text-ink2">
        {label}
      </span>
      <span className="flex-1 truncate font-mono text-[11.5px] text-ink2">
        {value ?? "—"}
      </span>
      {present && (
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard?.writeText(value ?? "")}
          className="shrink-0 rounded-[6px] p-1 text-ink3 transition-colors hover:bg-hov hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <CopyIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// A single vertical-stepper node for the engine-state timeline (§6.9).
function TimelineStep({
  entry,
  isLast,
}: {
  entry: AdminTxnTimelineEntry
  isLast: boolean
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-sok text-tok">
          <CheckIcon className="size-3" strokeWidth={2.4} />
        </span>
        {!isLast && <span className="min-h-4 w-0.5 flex-1 bg-line2" />}
      </div>
      <div className="flex-1 pb-3.5">
        <div className="text-[12.5px] font-bold text-ink">{entry.status}</div>
        <div className="font-mono text-[10.5px] text-ink3 tabular-nums">
          {formatDate(entry.at)}
        </div>
      </div>
    </li>
  )
}

// Left column: itemized parameters (as confirmed to the user) + margin note.
function ItemizedParameters({ txn }: { txn: AdminTxnDetail }) {
  const rows: Array<{ k: string; v: string; danger?: boolean }> = [
    { k: "Type", v: txn.type },
    { k: "Status", v: txn.status },
    { k: "User", v: txn.userId },
    { k: "Created", v: formatDate(txn.createdAt) },
    { k: "Executed", v: formatDate(txn.executedAt) },
    { k: "Completed", v: formatDate(txn.completedAt) },
  ]
  if (txn.failureReason) {
    rows.push({ k: "Failure reason", v: txn.failureReason, danger: true })
  }

  return (
    <Panel>
      <PanelTitle note="as confirmed to user">Itemized parameters</PanelTitle>
      <dl>
        {rows.map((row) => (
          <div
            key={row.k}
            className="flex justify-between gap-3 border-b border-line2 py-2.5 last:border-b-0"
          >
            <dt className="text-[12.5px] text-ink2">{row.k}</dt>
            <dd
              className={`font-mono text-[12.5px] font-bold tabular-nums ${
                row.danger ? "text-tdn" : "text-ink"
              }`}
            >
              {row.v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center gap-2.5 rounded-[10px] bg-card2 px-3 py-2.5">
        <InfoIcon className="size-[15px] shrink-0 text-ink3" />
        <span className="text-[11px] text-ink2">
          Rate is spread-folded. Internal margin is operator-only — never shown
          to end users.
        </span>
      </div>
    </Panel>
  )
}

// Left column: the double-entry ledger mini-table (§6.9).
function LedgerLegs({ txn }: { txn: AdminTxnDetail }) {
  return (
    <Panel>
      <PanelTitle>Double-entry ledger</PanelTitle>
      {txn.ledgerLegs.length === 0 ? (
        <p className="text-[12px] text-ink3">No ledger legs.</p>
      ) : (
        <div>
          <div className="grid grid-cols-[1.6fr_0.7fr_1fr_0.9fr] gap-2 px-0.5 pb-2 text-[10px] font-bold tracking-[0.04em] text-ink3 uppercase">
            <div>Account</div>
            <div>Dir</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Balance</div>
          </div>
          {txn.ledgerLegs.map((leg, i) => (
            <div
              key={`${leg.accountId}-${leg.postedAt}-${i}`}
              className="grid grid-cols-[1.6fr_0.7fr_1fr_0.9fr] items-center gap-2 border-t border-line2 px-0.5 py-2.5"
            >
              <span className="truncate font-mono text-[11.5px] text-ink2">
                {leg.accountType}/{leg.accountId.slice(0, 6)}…
              </span>
              <span
                className={`text-[11px] font-extrabold ${
                  leg.direction === "debit" ? "text-tdn" : "text-tok"
                }`}
              >
                {leg.direction === "debit" ? "− Dr" : "+ Cr"}
              </span>
              <span className="text-right font-mono text-[11.5px] font-bold text-ink tabular-nums">
                {leg.amount} {leg.currency}
              </span>
              <span className="text-right font-mono text-[11px] text-ink3 tabular-nums">
                {leg.balanceAfter}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
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
      <SheetContent className="w-full gap-0 overflow-y-auto bg-bg sm:max-w-2xl">
        <SheetHeader className="gap-0 p-6 pb-4">
          {/* Back-link */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mb-3.5 inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-ink2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronLeftIcon className="size-4" />
            All transactions
          </button>

          {/* ── Title · status pill · copyable id ─────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2.5">
            <SheetTitle className="text-[21px] font-extrabold tracking-[-0.02em] text-ink capitalize">
              {txn ? txn.type : "Transaction"}
            </SheetTitle>
            {txn && <TransactionStatusBadge status={txn.status} />}
          </div>
          <SheetDescription className="sr-only">
            {txn ? `${txn.type} · ${txn.id}` : "Loading transaction"}
          </SheetDescription>
          {txn && (
            <button
              type="button"
              aria-label="Copy transaction id"
              onClick={() => void navigator.clipboard?.writeText(txn.id)}
              className="mt-1.5 inline-flex w-fit items-center gap-1.5 font-mono text-[12px] text-ink3 transition-colors hover:text-ink2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {txn.id}
              <CopyIcon className="size-3" />
            </button>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-3.5 px-6 pb-6">
          {/* ── Loading ──────────────────────────────────────────────────── */}
          {detail.isLoading && (
            <div className="flex flex-col gap-3.5" aria-busy="true">
              <Skeleton className="h-40 w-full rounded-[16px]" />
              <Skeleton className="h-28 w-full rounded-[16px]" />
              <Skeleton className="h-28 w-full rounded-[16px]" />
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {detail.isError && (
            <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
              <p className="text-sm font-bold text-tdn">
                Failed to load this transaction
              </p>
              <p className="mt-1 text-xs text-ink3">Close and try again.</p>
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────────────── */}
          {detail.isSuccess && txn && (
            <>
              {/* Engine-brokered triage actions (settling / failed only) */}
              {TRIAGEABLE.has(txn.status) && (
                <Panel>
                  <PanelTitle note="engine-brokered">Triage</PanelTitle>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label
                        htmlFor="txn-fail-reason"
                        className="text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase"
                      >
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
                        <XIcon className="size-3.5" />
                        Mark failed
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={() => onRetry(txn.id)}
                      >
                        Retry settlement
                      </Button>
                    </div>
                    {localError && (
                      <p role="alert" className="text-xs text-tdn">
                        {localError}
                      </p>
                    )}
                  </div>
                </Panel>
              )}

              {/* ── 1.15fr / 1fr grid ─────────────────────────────────────── */}
              <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1.15fr_1fr]">
                {/* Left: itemized parameters + double-entry ledger */}
                <div className="flex flex-col gap-3.5">
                  <ItemizedParameters txn={txn} />
                  <LedgerLegs txn={txn} />
                </div>

                {/* Right: engine-state timeline + provider references */}
                <div className="flex flex-col gap-3.5">
                  <Panel>
                    <PanelTitle>Engine state timeline</PanelTitle>
                    {txn.timeline.length === 0 ? (
                      <p className="text-[12px] text-ink3">
                        No lifecycle events.
                      </p>
                    ) : (
                      <ol>
                        {txn.timeline.map((entry, i) => (
                          <TimelineStep
                            key={`${entry.status}-${entry.at}`}
                            entry={entry}
                            isLast={i === txn.timeline.length - 1}
                          />
                        ))}
                      </ol>
                    )}
                  </Panel>

                  <Panel>
                    <PanelTitle>Provider references</PanelTitle>
                    <div>
                      <ReferenceRow
                        label="Idempotency"
                        value={txn.idempotencyKey}
                      />
                      <ReferenceRow
                        label="Processor"
                        value={txn.processorTxRef}
                      />
                      <ReferenceRow
                        label="On-chain"
                        value={txn.onChainTxHash}
                      />
                    </div>
                  </Panel>
                </div>
              </div>
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
