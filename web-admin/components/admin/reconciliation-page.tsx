"use client"

/**
 * ReconciliationPage — provider-vs-ledger reconciliation (design §6.12 Recon,
 * docs/design-ref/screens/Recon.html). A cron status bar (last/next run + open-breaks
 * count) over a stack of break cards. Each break carries an icon tile, a kind label, a
 * severity pill, a mono link to the offending tx, a signed delta, and — while OPEN — the
 * funds-safety note plus three actions (Escalate to case / Accept / Resolve via engine).
 *
 * Phase 6b: the break LIST and the cron STATUS BAR are now LIVE — sourced from
 * `useReconBreaks` (provider-vs-ledger breaks projected from unresolved compensations +
 * stuck settlements) and `useReconStatus` (the reconciler-cron timeline). Every async
 * branch (loading / error / empty / data) is handled. The `lib/api/reconciliation`
 * client is the only door to the server.
 *
 * DEFERRED to Phase 7 (write path): the three per-break actions (Resolve via engine /
 * Accept / Escalate) still open the shared flow modals and settle to LOCAL state only —
 * there is no break-resolution WRITE endpoint yet. "Run now" likewise re-fetches the
 * live queries rather than triggering a server run.
 *
 * Funds-safety invariant preserved in the UI (root §3.1): over-credits are flagged for
 * human action, NEVER auto-debited — resolution is engine-brokered, never a raw ledger
 * debit from this surface.
 */
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { ReconBreak, ReconBreakKind } from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { useReconBreaks, useReconStatus } from "@/lib/query/hooks"
import { Skeleton } from "@/components/ui/skeleton"
import {
  EngineActionModal,
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
  ReconBreakResolution,
  ReconBreakSeverity,
} from "@/types/components"

// Severity → the design's pill (10px/800 uppercase). Mapped onto the canonical status
// token pairs (§5): high = danger, medium = warn, low = info. Colour is never the sole
// signal — the uppercase label carries severity.
const SEVERITY_META: Record<
  ReconBreakSeverity,
  { label: string; bg: string; fg: string }
> = {
  high: { label: "High", bg: "bg-sdn", fg: "text-tdn" },
  medium: { label: "Medium", bg: "bg-swn", fg: "text-twn" },
  low: { label: "Low", bg: "bg-sif", fg: "text-tif" },
}

// Per-kind display metadata: a human label + a tinted 36px icon tile + a stroke path.
// Keyed by the contract's snake_case ReconBreakKind.
const KIND_META: Record<
  ReconBreakKind,
  { label: string; path: string; tile: string; fg: string }
> = {
  // Over-credit — a triangle warning (ledger credited more than the provider).
  over_credit: {
    label: "Over-credit",
    path: "M12 8v5M12 16h.01M12 3l9 16H3z",
    tile: "bg-sdn",
    fg: "text-tdn",
  },
  // Missing settlement — a clock (provider confirmed, ledger not yet posted).
  missing_settlement: {
    label: "Missing settlement",
    path: "M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    tile: "bg-swn",
    fg: "text-twn",
  },
  // Amount mismatch — opposing arrows (provider and ledger amounts diverge).
  amount_mismatch: {
    label: "Amount mismatch",
    path: "M7 7h10M7 7l3-3M7 7l3 3M17 17H7m10 0-3 3m3-3-3-3",
    tile: "bg-swn",
    fg: "text-twn",
  },
  // Duplicate credit — stacked squares (the same credit landed twice).
  duplicate_credit: {
    label: "Duplicate credit",
    path: "M9 9h10v10H9zM5 5h10v2M5 5v10h2",
    tile: "bg-sif",
    fg: "text-tif",
  },
}

// Open-card border echoes the design's tinted border on open breaks.
const OPEN_CARD_LINE: Record<ReconBreakSeverity, string> = {
  high: "border-sdn",
  medium: "border-swn",
  low: "border-sif",
}

/**
 * Delta tint from the break kind: danger for over/duplicate credits (a positive delta
 * the ledger owes back), warn for mismatches, muted for missing settlements. Mirrors
 * the design's per-row deltaFg without needing a separate contract field.
 */
function deltaTone(kind: ReconBreakKind): string {
  if (kind === "over_credit" || kind === "duplicate_credit") return "text-tdn"
  if (kind === "amount_mismatch") return "text-twn"
  return "text-ink2"
}

/** The signed delta + its asset, rendered mono/tabular (e.g. "+50.00 USDT"). */
function formatDelta(b: ReconBreak): string {
  return `${b.delta} ${b.asset}`
}

// Engine-action modal payload for "Resolve via engine" — an itemized effect +
// double-entry preview derived from the real break. Demonstrates the funds-safety
// path (validation + double-entry + idempotency) the design encodes; the actual
// engine WRITE is Phase 7.
function engineEffect(b: ReconBreak): EngineEffectRow[] {
  return [
    { k: "Transaction", v: b.transactionId },
    { k: "Break kind", v: KIND_META[b.kind].label },
    { k: "Provider-vs-ledger delta", v: formatDelta(b) },
    { k: "Resolution", v: "Reverse excess ledger entry" },
  ]
}

function engineLedger(b: ReconBreak): EngineLedgerRow[] {
  const amt = b.delta.replace(/^\+/, "")
  return [
    { acct: "user:wallet:usdt", dir: "DR", amt },
    { acct: "recon:adjustment", dir: "CR", amt },
  ]
}

// Maker-checker diff for "Accept" — a dual-control state change on the break's
// disposition, matching the design's from→to change-preview shape.
function acceptDiff(b: ReconBreak): MakerCheckerDiffRow[] {
  return [
    { field: `Break ${b.transactionId}`, from: "Open", to: "Accepted (no debit)" },
  ]
}

/** The three action flows a break card can open. */
type FlowStep =
  | { kind: "resolve"; stage: "reason" | "stepup" | "engine" }
  | { kind: "accept" }
  | { kind: "escalate" }

/** A break with a locally-applied Phase-7 outcome overlaid on the live row. */
type BreakView = ReconBreak & { localResolution?: ReconBreakResolution }

/** Formats an ISO timestamp for the status bar (e.g. "04:00"), or "—" when null. */
function formatRunTime(iso: string | null): string {
  if (iso === null) return "—"
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function ReconciliationPage() {
  const router = useRouter()
  const breaksQuery = useReconBreaks()
  const statusQuery = useReconStatus()

  // Locally-applied Phase-7 outcomes keyed by break id (the resolution WRITE does not
  // exist yet, so a resolved/accepted/escalated break is reflected in local state only
  // until the next refetch).
  const [localOutcomes, setLocalOutcomes] = useState<
    Record<string, ReconBreakResolution>
  >({})
  // The break whose flow is currently open + which step of that flow is showing.
  const [active, setActive] = useState<{ id: string; flow: FlowStep } | null>(
    null
  )

  const breaks: BreakView[] = useMemo(
    () =>
      (breaksQuery.data?.items ?? []).map((b) => ({
        ...b,
        localResolution: localOutcomes[b.id],
      })),
    [breaksQuery.data, localOutcomes]
  )

  // Prefer the server's open-break count; fall back to the loaded list while it settles.
  const openCount =
    statusQuery.data?.openBreakCount ??
    breaks.filter((b) => b.localResolution === undefined).length

  const activeBreak = active
    ? (breaks.find((b) => b.id === active.id) ?? null)
    : null

  function closeFlow() {
    setActive(null)
  }

  // Apply a Phase-7 outcome to a break locally (drives the closed-card footer) + close.
  function settle(id: string, resolution: ReconBreakResolution) {
    setLocalOutcomes((prev) => ({ ...prev, [id]: resolution }))
    closeFlow()
  }

  return (
    <div
      data-screen-label="Reconciliation"
      className="mx-auto max-w-[1120px] px-[30px] pt-[26px] pb-[60px]"
    >
      {/* Header block */}
      <div className="mb-4">
        <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">
          Reconciliation
        </h1>
        <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
          Provider-vs-ledger breaks. Over-credits are flagged for human action —
          never auto-debited.
        </p>
      </div>

      {/* Cron status bar — live from useReconStatus */}
      <div className="mb-4 flex flex-wrap items-center gap-[14px] rounded-[14px] border border-line bg-card px-[18px] py-[14px]">
        <div className="flex items-center gap-[9px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sok text-tok">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <div className="text-[12.5px] font-bold">Reconciliation cron</div>
            {statusQuery.isError ? (
              <div className="text-[11px] text-tdn">
                Failed to load reconciliation status
              </div>
            ) : statusQuery.isLoading ? (
              <Skeleton className="mt-1 h-3 w-56 rounded" />
            ) : (
              <div className="text-[11px] text-ink3">
                Last run {formatRunTime(statusQuery.data?.lastRunAt ?? null)} ·
                next {formatRunTime(statusQuery.data?.nextRunAt ?? null)} ·{" "}
                <span className="tabular-nums">{openCount}</span> open breaks
                {statusQuery.data?.enabled === false ? " · paused" : ""}
              </div>
            )}
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            // Phase 7 will trigger a server-side reconciliation run; for now re-fetch
            // the live queries so the operator sees the freshest break set.
            void breaksQuery.refetch()
            void statusQuery.refetch()
          }}
          className="flex h-9 items-center gap-[7px] rounded-[10px] border border-line bg-card px-[15px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M6 4l14 8-14 8z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          Run now
        </button>
      </div>

      {/* Break cards — loading / error / empty / data */}
      {breaksQuery.isError ? (
        <div className="rounded-2xl border border-line bg-card px-5 py-8 text-center">
          <p className="text-[12.5px] font-semibold text-tdn">
            Failed to load reconciliation breaks
          </p>
          <button
            type="button"
            onClick={() => void breaksQuery.refetch()}
            className="mt-2 rounded-[9px] bg-btn-dark px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      ) : breaksQuery.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-[104px] rounded-2xl" />
          <Skeleton className="h-[104px] rounded-2xl" />
          <Skeleton className="h-[104px] rounded-2xl" />
        </div>
      ) : breaks.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card px-5 py-10 text-center">
          <p className="text-[13px] font-bold text-ink">No open breaks</p>
          <p className="mt-1 text-[12px] text-ink3">
            Provider and ledger are reconciled — nothing needs human action.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {breaks.map((b) => {
            const meta = KIND_META[b.kind]
            const sev = SEVERITY_META[b.severity]
            const isOpen = b.localResolution === undefined
            return (
              <div
                key={b.id}
                className={cn(
                  "rounded-2xl border bg-card px-5 py-4",
                  isOpen ? OPEN_CARD_LINE[b.severity] : "border-line"
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-9 flex-none items-center justify-center rounded-[10px]",
                      meta.tile,
                      meta.fg
                    )}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d={meta.path}
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[9px]">
                      <span className="text-sm font-bold">{meta.label}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase",
                          sev.bg,
                          sev.fg
                        )}
                      >
                        {sev.label}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/transactions/${b.transactionId}`)
                        }
                        className="font-mono text-[11px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {b.transactionId}
                      </button>
                    </div>
                    <div className="mt-1 text-[12.5px] leading-[1.45] text-ink2">
                      {b.detail}
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="text-[10px] font-bold text-ink3 uppercase">
                      Delta
                    </div>
                    <div
                      className={cn(
                        "font-mono text-sm font-extrabold tabular-nums",
                        deltaTone(b.kind)
                      )}
                    >
                      {formatDelta(b)}
                    </div>
                  </div>
                </div>

                {isOpen ? (
                  <div className="mt-3.5 flex items-center gap-[9px] border-t border-line2 pt-3.5">
                    <div className="flex flex-1 items-center gap-1.5 text-[11px] text-ink3">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d="M12 8v5M12 16h.01M12 3l9 16H3z"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Resolution is engine-brokered · never a raw debit.
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setActive({ id: b.id, flow: { kind: "escalate" } })
                      }
                      className="rounded-[9px] border border-line px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      Escalate to case
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActive({ id: b.id, flow: { kind: "accept" } })
                      }
                      className="rounded-[9px] border border-line px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActive({
                          id: b.id,
                          flow: { kind: "resolve", stage: "reason" },
                        })
                      }
                      className="rounded-[9px] bg-brand-green px-4 py-2 text-xs font-extrabold text-white transition-colors hover:bg-brand-green/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      Resolve via engine
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-[7px] text-xs font-bold text-tok">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="m5 12 5 5L20 7"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {b.localResolution === "escalated"
                      ? "Escalated to case"
                      : b.localResolution === "accepted"
                        ? "Accepted (no debit)"
                        : "Resolved"}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Flow modals (shared) ──────────────────────────────────────────────
          Escalate → reason (audit) → open a compliance case.
          Accept   → maker-checker (dual-control state change, no debit).
          Resolve  → reason → step-up TOTP → engine-action (double-entry + idem).
          All settle to LOCAL state only — the write endpoints are Phase 7. */}
      {activeBreak && (
        <>
          {/* Escalate: reason only → escalated outcome */}
          <ReasonModal
            open={active?.flow.kind === "escalate"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`Escalate ${activeBreak.transactionId} to case`}
            onContinue={() => settle(activeBreak.id, "escalated")}
          />

          {/* Accept: maker-checker dual-control → accepted outcome */}
          <MakerCheckerModal
            open={active?.flow.kind === "accept"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`Accept break ${activeBreak.transactionId}`}
            diff={acceptDiff(activeBreak)}
            onSubmit={() => settle(activeBreak.id, "accepted")}
          />

          {/* Resolve via engine: reason → step-up → engine-action */}
          <ReasonModal
            open={
              active?.flow.kind === "resolve" && active.flow.stage === "reason"
            }
            onOpenChange={(o) => !o && closeFlow()}
            title={`Resolve ${activeBreak.transactionId} via engine`}
            onContinue={() =>
              setActive({
                id: activeBreak.id,
                flow: { kind: "resolve", stage: "stepup" },
              })
            }
          />
          <StepUpModal
            open={
              active?.flow.kind === "resolve" && active.flow.stage === "stepup"
            }
            onOpenChange={(o) => !o && closeFlow()}
            title={`resolve ${activeBreak.transactionId}`}
            onComplete={() =>
              setActive({
                id: activeBreak.id,
                flow: { kind: "resolve", stage: "engine" },
              })
            }
          />
          <EngineActionModal
            open={
              active?.flow.kind === "resolve" && active.flow.stage === "engine"
            }
            onOpenChange={(o) => !o && closeFlow()}
            title={`Resolve ${KIND_META[activeBreak.kind].label.toLowerCase()}`}
            effect={engineEffect(activeBreak)}
            ledger={engineLedger(activeBreak)}
            idempotencyKey={`recon-${activeBreak.id}-resolve`}
            cta="Resolve via engine"
            onExecute={() => settle(activeBreak.id, "resolved")}
          />
        </>
      )}
    </div>
  )
}
