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
import { useMemo, useState } from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import { pushToast } from "@/lib/store/toast-store"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/admin/status-pill"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdminMe,
  useCreateChange,
  useMarkFailed,
  useRerunReconciliation,
  useRetrySettlement,
  useTransactionDetail,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import {
  EngineActionModal,
  MakerCheckerModal,
  ReasonModal,
} from "@/components/admin/flows"
import type {
  AdminTxnDetail,
  AdminTxnEconomics,
  AdminTxnLedgerLeg,
  AdminTxnStatus,
  AdminTxnTimelineEntry,
  CreateChangeRequest,
  ReconBreak,
} from "@handshake-agent/contracts"
import type {
  EngineLedgerRow,
  MakerCheckerDiffRow,
  StatusPillStatus,
  TransactionDetailProps,
} from "@/types/components"

// ─── Presentation helpers ─────────────────────────────────────────────────────────

/** Subtle placeholder for a design field the contract does not yet provide. */
const DASH = "—"

/** Format an ISO timestamp for the timeline / created displays. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString()
}

/**
 * The header title: "{type} · {amount} {asset}" when the economics carry an
 * amount (design's `{type} · {amount} USDT`), else just the capitalized type.
 */
function headerTitle(tx: AdminTxnDetail): string {
  const { amount, asset } = tx.economics
  if (amount && asset) return `${tx.type} · ${amount} ${asset}`
  if (amount) return `${tx.type} · ${amount}`
  return tx.type
}

/**
 * Fold the engine's `TransactionStatus` onto the canonical StatusPill status.
 * The pill map has no `settling`/`confirmed`/etc. keys, so terminal-good folds to
 * `settled`, in-flight to `pending_settlement`, failures to `failed`, reversals
 * to `refunded`, and the early lifecycle to `initiated`.
 */
const STATUS_TO_PILL: Record<AdminTxnStatus, StatusPillStatus> = {
  pending: "initiated",
  validating: "quoted",
  confirmed: "quoted",
  settling: "pending_settlement",
  completed: "settled",
  failed: "failed",
  rolled_back: "refunded",
  cancelled: "failed",
}

/** A concise human label per engine status for the pill (design-consistent). */
const STATUS_LABEL: Record<AdminTxnStatus, string> = {
  pending: "Pending",
  validating: "Validating",
  confirmed: "Confirmed",
  settling: "Pending settlement",
  completed: "Settled",
  failed: "Failed",
  rolled_back: "Rolled back",
  cancelled: "Cancelled",
}

// Human labels for the re-run-recon break kinds (mirrors the recon page's KIND_META,
// label-only — this surface renders a compact result row, not the full break card).
const RECON_KIND_LABEL: Record<ReconBreak["kind"], string> = {
  over_credit: "Over-credit",
  missing_settlement: "Missing settlement",
  amount_mismatch: "Amount mismatch",
  duplicate_credit: "Duplicate credit",
}

// ── Engine state timeline ────────────────────────────────────────────────────────
type TimelineTone = "done" | "pending" | "fail"

// tone → { dot bg/fg, label fg, icon path } (logic.js done/pend/fail, lines 710-712).
const TIMELINE_TONE: Record<
  TimelineTone,
  { dotBg: string; dotFg: string; fg: string; icon: string }
> = {
  done: {
    dotBg: "bg-[#1f8a5b]",
    dotFg: "text-white",
    fg: "text-ink",
    icon: "m5 12 5 5L20 7",
  },
  pending: {
    dotBg: "bg-swn",
    dotFg: "text-twn",
    fg: "text-twn",
    icon: "M12 7v5l3 2",
  },
  fail: {
    dotBg: "bg-sdn",
    dotFg: "text-tdn",
    fg: "text-tdn",
    icon: "M6 6l12 12M18 6L6 18",
  },
}

/** Map an engine timeline entry's status onto a stepper tone. */
function timelineTone(status: string): TimelineTone {
  if (status === "failed" || status === "cancelled" || status === "rolled_back")
    return "fail"
  if (status === "completed" || status === "confirmed") return "done"
  return "pending"
}

// ── Header action buttons (txActions, logic.js lines 736-741) ────────────────────
type FlowKind = "retry" | "refund" | "markFailed" | "recon" | "receipt"
interface ActionButton {
  label: string
  /** the flow this action opens; `receipt` is a no-op toast in the design. */
  kind: FlowKind
  icon: string
  danger?: boolean
}
// The engine-brokered triage actions (Phase 7 owns their writes — propose-only here).
const TX_ACTIONS: ActionButton[] = [
  {
    label: "Retry settlement",
    kind: "retry",
    icon: "M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4",
  },
  {
    label: "Refund",
    kind: "refund",
    icon: "M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4",
  },
  {
    label: "Mark failed",
    kind: "markFailed",
    icon: "M6 6l12 12M18 6L6 18",
    danger: true,
  },
  { label: "Re-run recon", kind: "recon", icon: "M12 4v16M4 20h16" },
  { label: "Resend receipt", kind: "receipt", icon: "M4 4h16v12H8l-4 4z" },
]

// ── Flow-step context per action (mirrors runFlow ctx, logic.js 668-681) ─────────
// The presentation-only step-up box is dropped in favour of the REAL StepUpDialog
// (which verifies the code server-side and replays the mutation on 403). So the
// chains are: retry → engine; mark-failed → reason → engine; refund → reason →
// maker (the four-eyes change-request). The engine/maker submit fires the write.
type FlowStep = "reason" | "engine" | "maker"
interface FlowSpec {
  steps: FlowStep[]
  title: string
  cta: string
  effect: { k: string; v: string }[]
  ledger: EngineLedgerRow[]
  diff?: MakerCheckerDiffRow[]
}

/**
 * Build the flow spec for a triage action from the REAL transaction detail. Each
 * chain's terminal step is the one wired to the mutation: `engine` for the
 * engine-brokered retry/mark-failed, `maker` for the four-eyes refund request.
 */
function flowSpecFor(kind: FlowKind, tx: AdminTxnDetail): FlowSpec | null {
  const engineLedger: EngineLedgerRow[] = tx.ledgerLegs.map((l) => ({
    acct: `${l.accountType}:${l.accountId}:${l.currency}`,
    dir: l.direction === "debit" ? "DR" : "CR",
    amt: l.amount,
  }))

  switch (kind) {
    case "retry":
      return {
        steps: ["engine"],
        title: "Retry settlement",
        cta: "Execute retry via engine",
        effect: [
          { k: "Transaction", v: tx.id },
          { k: "Directive", v: "settlement.retry" },
          { k: "Type", v: tx.type },
        ],
        // Retry re-enqueues settlement — it writes no ledger legs itself (§3.1).
        ledger: [],
      }
    case "refund":
      return {
        steps: ["reason", "maker"],
        title: "Refund",
        cta: "Submit for approval",
        diff: [
          {
            field: `Refund · ${tx.id}`,
            from: "Settling",
            to: "Failed + refunded",
          },
        ],
        effect: [
          { k: "Original tx", v: tx.id },
          { k: "User", v: tx.userId },
        ],
        ledger: engineLedger,
      }
    case "markFailed":
      return {
        steps: ["reason", "engine"],
        title: "Mark failed",
        cta: "Mark failed via engine",
        effect: [
          { k: "Transaction", v: tx.id },
          { k: "Directive", v: "mark_failed" },
        ],
        ledger: engineLedger,
      }
    case "recon":
      // Read-only provider-vs-ledger detection (not a settlement re-drive). No reason
      // step: it moves no money, so it goes straight to a confirm → step-up → run.
      return {
        steps: ["engine"],
        title: "Re-run reconciliation",
        cta: "Run reconciliation",
        effect: [
          { k: "Transaction", v: tx.id },
          { k: "Check", v: "Provider-vs-ledger reconciliation" },
          { k: "Effect", v: "Read-only — detects breaks, moves no money" },
        ],
        // A detection pass posts no ledger legs (§3.1).
        ledger: [],
      }
    case "receipt":
      return null // design: no flow — just a toast
  }
}

// ─── Card primitives (design §5: white/--card, 1px --line, radius 16, pad 18/20) ──

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      {children}
    </div>
  )
}

function PanelTitle({
  children,
  note,
}: {
  children: React.ReactNode
  note?: string
}) {
  return (
    <div className="mb-3 text-[13px] font-extrabold text-ink">
      {children}
      {note && <span className="font-semibold text-ink3"> · {note}</span>}
    </div>
  )
}

// ─── Screen ─────────────────────────────────────────────────────────────────────

const LEDGER_GRID = "grid grid-cols-[1.6fr_0.7fr_1fr_0.7fr] gap-2"

// The flow phases a triage action can move through (design runFlow, minus the
// presentation-only step-up — the real StepUpDialog handles re-auth).
type ActivePhase = FlowStep | null

/** Narrow an unknown error to its operator-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "The action could not be completed."
}

export function TransactionDetail({ transactionId }: TransactionDetailProps) {
  const query = useTransactionDetail(transactionId)
  const tx = query.data

  const me = useAdminMe()
  const retry = useRetrySettlement()
  const markFailed = useMarkFailed()
  const createChange = useCreateChange()
  const rerunRecon = useRerunReconciliation()
  const stepUp = useStepUpRetry()

  const [copied, setCopied] = useState<string | null>(null)
  // The in-flight action + how far through its step list we are.
  const [activeKind, setActiveKind] = useState<FlowKind | null>(null)
  const [phase, setPhase] = useState<ActivePhase>(null)
  // The reason captured in the ReasonModal — threaded into the audited mutation.
  const [reason, setReason] = useState("")
  // The last re-run-reconciliation outcome (breaks it detected) — shown inline once a
  // run completes. `null` = no run yet; the reconciled path returns an empty list.
  const [reconResult, setReconResult] = useState<ReconBreak[] | null>(null)

  const spec = useMemo(
    () => (activeKind && tx ? flowSpecFor(activeKind, tx) : null),
    [activeKind, tx]
  )

  const executing =
    retry.isPending ||
    markFailed.isPending ||
    createChange.isPending ||
    rerunRecon.isPending

  // The re-run-recon result panel's loading / error branches, derived (never seeded
  // into state). A step-up 403 is an expected re-auth prompt (the StepUpDialog is up
  // and will replay) — not a failure — so the error is suppressed while it is open.
  const reconLoading = rerunRecon.isPending
  const reconError =
    rerunRecon.isError && activeKind === "recon" && !stepUp.open
      ? errorMessage(rerunRecon.error)
      : null

  function copy(value: string) {
    void navigator.clipboard?.writeText(value)
    setCopied(value)
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 1600)
  }

  function startAction(kind: FlowKind) {
    if (kind === "receipt") {
      // Design: no engine flow — just re-send the receipt and confirm via toast.
      pushToast("Receipt re-sent to the customer", "info")
      return
    }
    if (!tx) return
    const next = flowSpecFor(kind, tx)
    if (!next) return
    setReason("")
    // A fresh recon run supersedes any prior result panel.
    if (kind === "recon") setReconResult(null)
    setActiveKind(kind)
    setPhase(next.steps[0])
  }

  function closeFlow() {
    setActiveKind(null)
    setPhase(null)
    setReason("")
  }

  // The ReasonModal's Continue: stash the reason, advance to the terminal step.
  function onReason(entered: string) {
    setReason(entered)
    if (spec) setPhase(spec.steps[spec.steps.indexOf("reason") + 1] ?? null)
  }

  // The engine/maker terminal submit → the REAL mutation for the active action.
  // Runs through `useStepUpRetry`: on a 403 ADMIN_STEP_UP_REQUIRED it opens the
  // real StepUpDialog and the retry replays this same action after re-auth.
  function runMutation(): Promise<void> {
    if (!tx || !activeKind) return Promise.resolve()
    switch (activeKind) {
      case "retry":
        return retry.mutateAsync(tx.id).then(() => undefined)
      case "markFailed":
        return markFailed
          .mutateAsync({ id: tx.id, input: { reason } })
          .then(() => undefined)
      case "refund": {
        // A refund is a four-eyes CHANGE REQUEST — it applies NOTHING here; a
        // second admin approves it, then the engine's atomic refund runs (§3.1).
        const input: CreateChangeRequest = {
          kind: "refund",
          resource: `Transaction:${tx.id}`,
          payload: { transactionId: tx.id, reason },
          reason,
        }
        return createChange.mutateAsync(input).then(() => undefined)
      }
      case "recon":
        // Read-only detection: re-run recon for this txn and stash the detected
        // breaks for the inline result panel (reason is optional — omitted here).
        return rerunRecon
          .mutateAsync({ id: tx.id, reason: reason || undefined })
          .then((res) => {
            setReconResult(res.items)
          })
      default:
        return Promise.resolve()
    }
  }

  function submitFlow() {
    const kind = activeKind
    void (async () => {
      const completed = await stepUp
        .run(runMutation)
        .catch((error) => {
          pushToast(errorMessage(error), "warn")
          return false
        })
      // `completed` is false when a step-up challenge opened (retry pending) — keep
      // the flow open so the StepUpDialog's success can replay it.
      if (completed) {
        // Re-run recon's feedback is its inline result panel — no toast needed.
        if (kind !== "recon") {
          pushToast(
            kind === "refund"
              ? "Refund submitted for approval"
              : "Action executed via the engine",
            "ok"
          )
        }
        closeFlow()
      }
    })()
  }

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
                    <LedgerRowView key={`${l.accountId}-${i}`} leg={l} />
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
                    <TimelineStepView
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
            mfaEnabled={me.data?.mfaEnabled ?? false}
            onOpenChange={stepUp.setOpen}
            onSuccess={() => {
              const kind = activeKind
              void stepUp
                .retry()
                .then((replayed) => {
                  if (!replayed) return
                  // Re-run recon's feedback is its inline result panel — no toast.
                  if (kind !== "recon") {
                    pushToast(
                      kind === "refund"
                        ? "Refund submitted for approval"
                        : "Action executed via the engine",
                      "ok"
                    )
                  }
                  closeFlow()
                })
                .catch((error) => pushToast(errorMessage(error), "warn"))
            }}
          />
        </>
      )}
    </div>
  )
}

// ─── Data-branch sub-renderers ────────────────────────────────────────────────────

/**
 * The itemized-parameter rows the design shows, each reading one field off the
 * real `AdminTxnEconomics` block. A null field renders as "—" (never fabricated).
 * The internal-margin row is operator-only (warn-toned) — never shown to users.
 */
function economicsRows(
  e: AdminTxnEconomics
): { label: string; value: string; warn?: boolean }[] {
  const amount =
    e.amount && e.asset ? `${e.amount} ${e.asset}` : e.amount ?? DASH
  const fiat =
    e.fiatAmount && e.fiatCurrency
      ? `${e.fiatCurrency} ${e.fiatAmount}`
      : e.fiatAmount ?? DASH
  const spread = e.fxSpreadBps ? `${e.fxSpreadBps} bps` : DASH
  return [
    { label: "Amount", value: amount },
    { label: "Fiat leg", value: fiat },
    { label: "Rate (spread-folded)", value: e.rate ?? DASH },
    { label: "Processing fee", value: e.processingFee ?? DASH },
    { label: "FX spread", value: spread },
    {
      label: "Internal margin (operator)",
      value: e.internalMargin ?? DASH,
      warn: true,
    },
  ]
}

/** One double-entry ledger leg → the design's Account/Dir/Amount/Seq row. */
function LedgerRowView({ leg }: { leg: AdminTxnLedgerLeg }) {
  const dir = leg.direction === "debit" ? "DEBIT" : "CREDIT"
  return (
    <div
      className={cn(
        LEDGER_GRID,
        "items-center border-t border-line2 px-0.5 py-[9px]"
      )}
    >
      <span className="truncate font-mono text-[11.5px] text-ink2">
        {`${leg.accountType}:${leg.accountId}:${leg.currency}`}
      </span>
      <span
        className={cn(
          "text-[11px] font-extrabold",
          dir === "DEBIT" ? "text-tdn" : "text-tok"
        )}
      >
        {dir}
      </span>
      <span className="text-right font-mono text-[11.5px] font-bold tabular-nums">
        {leg.amount}
      </span>
      {/* Seq: the per-account monotonic posting order. */}
      <span className="text-right font-mono text-[11px] text-ink3 tabular-nums">
        {leg.sequence}
      </span>
    </div>
  )
}

/** One derived lifecycle event → the design's vertical stepper node. */
function TimelineStepView({
  entry,
  hasNext,
}: {
  entry: AdminTxnTimelineEntry
  hasNext: boolean
}) {
  const tone = TIMELINE_TONE[timelineTone(entry.status)]
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-[22px] flex-none items-center justify-center rounded-full",
            tone.dotBg,
            tone.dotFg
          )}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d={tone.icon}
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        {hasNext && <span className="min-h-4 w-0.5 flex-1 bg-line2" />}
      </div>
      <div className="flex-1 pb-3.5">
        <div className={cn("text-[12.5px] font-bold capitalize", tone.fg)}>
          {entry.status}
        </div>
        <div className="font-mono text-[10.5px] text-ink3 tabular-nums">
          {formatWhen(entry.at)}
        </div>
      </div>
    </div>
  )
}

interface RefRow {
  label: string
  value: string
  link?: string
  href?: string
}

/** Per-provider display label + (for TRON) an external explorer link builder. */
const PROVIDER_META: Record<
  string,
  { label: string; explorer?: (ref: string) => { link: string; href: string } }
> = {
  tron: {
    label: "TRON",
    explorer: (ref) => ({
      link: "Tronscan",
      href: `https://tronscan.org/#/transaction/${ref}`,
    }),
  },
  flutterwave: { label: "Flutterwave" },
  blockradar: { label: "Blockradar" },
  swap: { label: "Swap" },
}

/**
 * Provider references from the backend projection (TRON hash + Tronscan link,
 * Flutterwave payout ref, Blockradar withdrawal id, swap id) plus the always-
 * present idempotency key. Unknown providers fall back to a title-cased label.
 */
function providerRefs(tx: AdminTxnDetail): RefRow[] {
  const refs: RefRow[] = tx.providerReferences.map((r) => {
    const meta = PROVIDER_META[r.provider]
    const label =
      meta?.label ?? r.provider[0].toUpperCase() + r.provider.slice(1)
    const explorer = meta?.explorer?.(r.reference)
    return {
      label,
      value: r.reference,
      ...(explorer ? { link: explorer.link, href: explorer.href } : {}),
    }
  })
  refs.push({ label: "Idempotency", value: tx.idempotencyKey })
  return refs
}

/**
 * The inline result of a "Re-run recon" pass (four branches): loading while the
 * detection runs, an error if it rejected, the reconciled (no-break) note when the
 * list is empty, or the detected breaks. Read-only — this panel only surfaces the
 * provider-vs-ledger discrepancy; remediation lives on the Reconciliation surface.
 */
function ReconResultPanel({
  loading,
  error,
  breaks,
}: {
  loading: boolean
  error: string | null
  breaks: ReconBreak[] | null
}) {
  return (
    <div className="mt-3.5">
      <Panel>
        <PanelTitle>Reconciliation re-run</PanelTitle>
        {loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-5 w-full rounded" />
            <Skeleton className="h-5 w-2/3 rounded" />
          </div>
        ) : error ? (
          <div className="rounded-[10px] border border-sdn bg-sdn/40 px-3 py-2.5">
            <p className="text-[12.5px] font-bold text-tdn">
              Reconciliation re-run failed
            </p>
            <p className="mt-0.5 text-[11.5px] text-ink2">{error}</p>
          </div>
        ) : breaks && breaks.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {breaks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-sdn bg-card px-3 py-2.5"
              >
                <span className="text-[12.5px] font-bold text-ink">
                  {RECON_KIND_LABEL[b.kind]}
                </span>
                <span className="font-mono text-[12px] font-extrabold tabular-nums text-tdn">
                  {`${b.delta} ${b.asset}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-[7px] text-[12.5px] font-bold text-tok">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m5 12 5 5L20 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Provider and ledger reconcile — no breaks detected.
          </div>
        )}
      </Panel>
    </div>
  )
}
