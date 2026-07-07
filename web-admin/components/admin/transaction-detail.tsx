"use client"

/**
 * TransactionDetail — the deterministic-engine's transaction record screen
 * (design `docs/design-ref/screens/TxDetail.html`, `pTxDetail`). Reached by
 * drilling into a Transactions row (`/transactions/[id]`).
 *
 * READ-WIRED (Phase 6a): the display values now come from the real
 * `useTransactionDetail(id)` read hook (GET /admin/transactions/:id →
 * `AdminTxnDetail`), replacing the former design-mock consts. The layout is
 * preserved 1:1; contract fields are mapped onto the existing presentation and
 * design fields the contract does not yet provide render gracefully as "—"
 * (recorded as shape gaps for the later backend-enrichment pass).
 *
 * Layout (1:1 with the markup + its inline styles):
 *  - back-link "All transactions"
 *  - header: `{type} · {amount}` title + status pill + copyable mono id, plus an
 *    action-button row (`txActions`) of engine-brokered triage actions
 *  - a `1.15fr / 1fr` grid:
 *      left  → Itemized parameters (as confirmed to user; operator-only margin
 *              note) + Double-entry ledger mini-table (Account/Dir/Amount/Seq,
 *              "Open ledger →")
 *      right → Engine state timeline (vertical stepper) + Provider references
 *              (label + mono value + copy + external link)
 *
 * Funds-safety (§3.1): every money action button opens the shared flow modals in
 * the design's sequence and WIRES their submit to the REAL engine-brokered
 * mutation (Phase 7, WRITES):
 *   - Retry settlement → `useRetrySettlement` (re-enqueues the settlement outbox;
 *     moves no money itself) — reason → engine-execute.
 *   - Mark failed → `useMarkFailed` (the engine's atomic `settle*RefundAtomic`
 *     reverses the reserve, idempotently) — reason → engine-execute.
 *   - Refund → `useCreateChange` of kind `refund` — a maker-checker request that
 *     APPLIES NOTHING until a SECOND admin approves it (four-eyes); on approval the
 *     engine's atomic refund runs. reason → maker-checker submit.
 *   - Re-run recon → `useRerunReconciliation` (Phase 8) — a READ-ONLY provider-vs-
 *     ledger detection for this one transaction; moves no money. confirm → step-up →
 *     the returned break list renders inline (four branches: loading/error/empty/data).
 * None of these writes a raw ledger entry (§3.1). Each is sensitive: on a 403 with
 * ADMIN_STEP_UP_REQUIRED we open the real StepUpDialog and replay via
 * `useStepUpRetry`. The invalidation (tx + list, inbox) lives in the hooks.
 */
import Link from "next/link"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/admin/status-pill"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useTransactionDetailScreen } from "@/lib/hooks/use-transaction-detail"
import {
  EngineActionModal,
  MakerCheckerModal,
  ReasonModal,
} from "@/components/admin/flows"
import type { TransactionDetailProps } from "@/types/components"
import {
  LEDGER_GRID,
  STATUS_LABEL,
  STATUS_TO_PILL,
  TX_ACTIONS,
} from "@/constants/transaction-detail"
import {
  economicsRows,
  headerTitle,
  providerRefs,
} from "@/lib/transactions/tx-detail"
import { Panel, PanelTitle } from "@/components/admin/transaction-detail/panel"
import { LedgerRow } from "@/components/admin/transaction-detail/ledger-row"
import { TimelineStep } from "@/components/admin/transaction-detail/timeline-step"
import { ReconResultPanel } from "@/components/admin/transaction-detail/recon-result-panel"

// ─── Screen ─────────────────────────────────────────────────────────────────────

export function TransactionDetail({ transactionId }: TransactionDetailProps) {
  const {
    query,
    tx,
    mfaEnabled,
    copied,
    copy,
    phase,
    reconResult,
    spec,
    executing,
    reconLoading,
    reconError,
    startAction,
    closeFlow,
    onReason,
    submitFlow,
    stepUp,
    onStepUpSuccess,
  } = useTransactionDetailScreen(transactionId)

  return (
    <div className="mx-auto w-full max-w-[1200px] overflow-y-auto px-[30px] pt-[22px] pb-[60px]">
      {/* ── Back-link ────────────────────────────────────────────────────────── */}
      <Link
        href="/transactions"
        className="mb-3.5 inline-flex items-center gap-[7px] text-[12.5px] font-bold text-ink2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 6l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All transactions
      </Link>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {query.isLoading && (
        <div className="flex flex-col gap-3.5" aria-busy="true">
          <Skeleton className="h-9 w-72 rounded-[10px]" />
          <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1.15fr_1fr]">
            <Skeleton className="h-72 rounded-[16px]" />
            <Skeleton className="h-72 rounded-[16px]" />
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {query.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
          <p className="text-sm font-bold text-tdn">
            Failed to load transaction
          </p>
          <p className="mt-1 text-[12.5px] text-ink2">
            The transaction record could not be fetched.
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-line bg-card px-[13px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Empty (loaded, no record) ────────────────────────────────────────── */}
      {query.isSuccess && !tx && (
        <div className="rounded-[16px] border border-line bg-card p-[50px] text-center text-[13px] text-ink3">
          No transaction found for this id.
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────────── */}
      {tx && (
        <>
          {/* ── Header: title · status pill · copyable id + action buttons ────── */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="m-0 text-[21px] font-extrabold tracking-[-0.02em] text-ink capitalize">
                  {headerTitle(tx)}
                </h1>
                <StatusPill
                  status={STATUS_TO_PILL[tx.status]}
                  label={STATUS_LABEL[tx.status]}
                  stuck={tx.status === "settling"}
                />
              </div>
              {tx.userEmail && (
                <div className="mt-0.5 text-[12px] text-ink3">
                  {tx.userEmail}
                </div>
              )}
              <button
                type="button"
                aria-label="Copy transaction id"
                onClick={() => copy(tx.id)}
                className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[12px] text-ink3 transition-colors hover:text-ink2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {copied === tx.id ? "Copied" : tx.id}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M9 9h10v10H9zM5 15V5h10"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {TX_ACTIONS.map((a) => (
                <button
                  key={a.kind}
                  type="button"
                  title={a.label}
                  onClick={() => startAction(a.kind)}
                  className={cn(
                    "flex h-9 items-center gap-[7px] rounded-[10px] border px-[13px] text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    a.danger
                      ? "border-[#f0d0cb] bg-card text-tdn hover:bg-sdn"
                      : "border-line bg-card text-ink hover:bg-hov"
                  )}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d={a.icon}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── 1.15fr / 1fr grid ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1.15fr_1fr]">
            {/* Left column */}
            <div className="flex flex-col gap-3.5">
              {/* ── Itemized parameters ─────────────────────────────────────── */}
              <Panel>
                <PanelTitle note="as confirmed to user">
                  Itemized parameters
                </PanelTitle>
                {/* Itemized economics projected from Transaction.metadata (quote/
                    price-snapshot): amount / fiat leg / rate / fee / spread, plus
                    the operator-only internal margin. Absent values render "—". */}
                <dl>
                  {economicsRows(tx.economics).map((k) => (
                    <div
                      key={k.label}
                      className="flex justify-between gap-3 border-b border-line2 py-[9px]"
                    >
                      <dt className="text-[12.5px] text-ink2">{k.label}</dt>
                      <dd
                        className={cn(
                          "font-mono text-[12.5px] font-bold tabular-nums",
                          k.warn ? "text-twn" : "text-ink3"
                        )}
                      >
                        {k.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 flex items-center gap-[9px] rounded-[10px] bg-card2 px-3 py-2.5">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className="text-ink3"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M12 8v5M12 16h.01"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="text-[11px] text-ink2">
                    Rate is spread-folded. Internal margin is operator-only —
                    never shown to end users.
                  </span>
                </div>
              </Panel>

              {/* ── Double-entry ledger ─────────────────────────────────────── */}
              <Panel>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[13px] font-extrabold text-ink">
                    Double-entry ledger
                  </div>
                  <Link
                    href={`/ledger?tx=${tx.id}`}
                    className="text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    Open ledger →
                  </Link>
                </div>
                <div
                  className={cn(
                    LEDGER_GRID,
                    "px-0.5 pb-2 text-[10px] font-bold tracking-[0.04em] text-ink3 uppercase"
                  )}
                >
                  <div>Account</div>
                  <div>Dir</div>
                  <div className="text-right">Amount</div>
                  <div className="text-right">Seq</div>
                </div>
                {tx.ledgerLegs.length === 0 ? (
                  <div className="border-t border-line2 py-4 text-center text-[12px] text-ink3">
                    No ledger legs posted yet.
                  </div>
                ) : (
                  tx.ledgerLegs.map((l, i) => (
                    <LedgerRow key={`${l.accountId}-${i}`} leg={l} />
                  ))
                )}
              </Panel>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-3.5">
              {/* ── Engine state timeline ───────────────────────────────────── */}
              <Panel>
                <div className="mb-3.5 text-[13px] font-extrabold text-ink">
                  Engine state timeline
                </div>
                {tx.timeline.length === 0 ? (
                  <div className="py-2 text-[12px] text-ink3">
                    No lifecycle events recorded.
                  </div>
                ) : (
                  tx.timeline.map((s, i) => (
                    <TimelineStep
                      key={`${s.status}-${i}`}
                      entry={s}
                      hasNext={i < tx.timeline.length - 1}
                    />
                  ))
                )}
              </Panel>

              {/* ── Provider references ─────────────────────────────────────── */}
              <Panel>
                <PanelTitle>Provider references</PanelTitle>
                {(() => {
                  const refs = providerRefs(tx)
                  if (refs.length === 0)
                    return (
                      <div className="py-1 text-[12px] text-ink3">
                        No provider references on this transaction.
                      </div>
                    )
                  return refs.map((r) => (
                    <div
                      key={r.label}
                      className="flex items-center gap-2.5 border-b border-line2 py-[9px] last:border-b-0"
                    >
                      <span className="flex-none rounded-[6px] bg-card2 px-2 py-0.5 text-[10.5px] font-bold text-ink2">
                        {r.label}
                      </span>
                      <button
                        type="button"
                        aria-label={`Copy ${r.label} reference`}
                        onClick={() => copy(r.value)}
                        className="flex-1 truncate text-left font-mono text-[11.5px] text-ink2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {copied === r.value ? "Copied" : r.value}
                      </button>
                      {r.link && r.href && (
                        <a
                          href={r.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-none text-[11px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {r.link} ↗
                        </a>
                      )}
                    </div>
                  ))
                })()}
              </Panel>
            </div>
          </div>

          {/* ── Re-run reconciliation result (four branches) ────────────────────── */}
          {/* loading = mutation in flight; error = the re-run rejected; empty =
              reconciled (no breaks); data = the detected breaks for this txn. A
              step-up 403 is NOT a failure — the StepUpDialog handles re-auth and
              replays, so its error is suppressed while that dialog is open. */}
          {(reconLoading || reconError !== null || reconResult !== null) && (
            <ReconResultPanel
              loading={reconLoading}
              error={reconError}
              breaks={reconResult}
            />
          )}

          {/* ── Flow modals (design runFlow: reason → engine [→ maker]) ─────────── */}
          {/* Suppressed while the real StepUpDialog is up so there is one dialog at
              a time; the step-up success replays the stashed mutation. */}
          {spec && (
            <>
              <ReasonModal
                open={phase === "reason" && !stepUp.open}
                onOpenChange={(o) => !o && !executing && closeFlow()}
                title={spec.title}
                onContinue={onReason}
              />
              <EngineActionModal
                open={phase === "engine" && !stepUp.open}
                onOpenChange={(o) => !o && !executing && closeFlow()}
                title={spec.title}
                effect={spec.effect}
                ledger={spec.ledger}
                idempotencyKey={tx.idempotencyKey}
                cta={spec.cta}
                onExecute={submitFlow}
              />
              <MakerCheckerModal
                open={phase === "maker" && !stepUp.open}
                onOpenChange={(o) => !o && !executing && closeFlow()}
                title={spec.title}
                diff={spec.diff ?? []}
                onSubmit={submitFlow}
              />
            </>
          )}

          {/* Real step-up — opened when a triage mutation 403s ADMIN_STEP_UP_REQUIRED. */}
          <StepUpDialog
            open={stepUp.open}
            mfaEnabled={mfaEnabled}
            onOpenChange={stepUp.setOpen}
            onSuccess={onStepUpSuccess}
          />
        </>
      )}
    </div>
  )
}
