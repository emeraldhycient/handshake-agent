"use client"

/**
 * BlockedPage — the deny-list surface (SPEC §6.7), WIRED to real data (Phase 9).
 * A title + subtitle header with a dark "+ Add entry" CTA, then a single card
 * holding a grid table: Kind (chip) · Value (mono) · Reason · Added-when · Unblock.
 *
 * "Blocked users, addresses and banks. Nothing is deleted — entries are
 * superseded." The list is append-only (§3.4): lifting a block SUPERSEDES the row
 * rather than deleting it, so the history stays auditable. Superseded rows still
 * render (dimmed, no Unblock action) so the audit trail is visible.
 *
 * DATA WIRING: the rows come from the real `useBlockedList()` (GET /admin/blocked);
 * the four async branches (loading / error / empty / data) each render. The two
 * write paths go through the shared funds-safety flow (SPEC §5), exactly as the
 * sanctions-page does:
 *  - Add → the purpose-built AddBlockedDialog collects a value; the page then
 *    captures an audited reason via the shared ReasonModal and fires the
 *    step-up-guarded `useAddBlocked` POST (the kind is DERIVED from the value
 *    shape). A 403 ADMIN_STEP_UP_REQUIRED opens the StepUpDialog and the POST
 *    replays after re-auth (`useStepUpRetry`).
 *  - Unblock → ReasonModal (audited reason) → StepUpModal (client TOTP) →
 *    step-up-guarded `useSupersedeBlocked` POST. Same server-side re-auth replay.
 * Neither moves money (§3.1); the list re-resolves via query invalidation in the
 * hooks and any error surfaces as a toast.
 */
import { useState } from "react"
import type {
  BlockedEntry,
  BlockedEntryKind,
} from "@handshake-agent/contracts"

import { AddBlockedDialog } from "@/components/admin/add-blocked-dialog"
import { ReasonModal, StepUpModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useAddBlocked,
  useAdminMe,
  useBlockedList,
  useSupersedeBlocked,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"

// Design §6.7 table grid — Kind · Value · Reason · Added · Unblock.
const BLOCKED_GRID = "grid-cols-[0.7fr_1.6fr_1.8fr_1.2fr_0.7fr]"

/** The human label for a deny-list kind chip. */
const KIND_LABEL: Record<BlockedEntryKind, string> = {
  user: "User",
  address: "Address",
  bank: "Bank",
}

/**
 * Derive the entry kind from the value's shape (the AddBlockedDialog collects only
 * the raw string). On-chain addresses (EVM / TRON) → "address"; a bare 10-digit
 * NUBAN → "bank"; everything else (a user id / handle) → "user".
 */
function deriveKind(value: string): BlockedEntryKind {
  const v = value.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(v) || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) {
    return "address"
  }
  if (/^\d{10}(\s|·|$)/.test(v)) return "bank"
  return "user"
}

/** Render an ISO timestamp as a short, locale-stable "Jun 30" label. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

/** Normalizes a mutation/step-up failure into a user-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

// The active supersede (unblock) flow (mirrors the sanctions-page `runFlow` chain):
// Unblock → reason (audited) → step-up (client TOTP) → the POST. The reason captured
// at the reason step is carried into the step-up step so the POST sends it.
type SupersedeFlow = {
  id: string
  value: string
  reason: string
  step: "reason" | "stepup"
}

// The pending add awaiting its audited reason: the dialog collected the value, the
// ReasonModal now captures the reason before the POST fires.
type PendingAdd = { value: string }

// A disposition awaiting a server step-up replay (so the toast after re-auth reads
// right). `kind: "add" | "supersede"` selects which mutation the replay targets.
type PendingReplay =
  | { kind: "add"; value: string }
  | { kind: "supersede"; value: string }

/** Loading placeholder for the deny-list rows (matches the row silhouette). */
function LoadingRows() {
  return (
    <div className="flex flex-col gap-0" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="border-b border-line2 px-[18px] py-[13px] last:border-b-0"
        >
          <Skeleton className="h-5 w-full" />
        </div>
      ))}
    </div>
  )
}

export function BlockedPage() {
  const list = useBlockedList()
  const entries = list.data?.items ?? []

  const me = useAdminMe()
  const add = useAddBlocked()
  const supersede = useSupersedeBlocked()
  const stepUp = useStepUpRetry()

  const [addOpen, setAddOpen] = useState(false)
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null)
  const [flow, setFlow] = useState<SupersedeFlow | null>(null)
  // The action awaiting a server step-up replay (so the success toast reads right).
  const [replay, setReplay] = useState<PendingReplay | null>(null)

  const denylist = entries.map((e) => e.value)

  /**
   * The AddBlockedDialog's onSave: it hands back the whole next denylist. We recover
   * the newly added value, close the dialog, and open the ReasonModal to capture the
   * audited reason before the POST fires (the reason is required server-side, §3.3).
   */
  async function onDialogSave(next: string[]) {
    const value = next.find((v) => !denylist.includes(v))
    if (!value) return
    setAddOpen(false)
    setPendingAdd({ value })
  }

  /** Fire the add through the server step-up guard; a 403 opens StepUpDialog. */
  function submitAdd(value: string, reason: string) {
    setPendingAdd(null)
    setReplay({ kind: "add", value })
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          add
            .mutateAsync({ kind: deriveKind(value), value, reason })
            .then(() => undefined)
        )
        if (ok) {
          pushToast(`Added to blocked list · ${value}`, "ok")
          setReplay(null)
        }
        // ok === false → a step-up challenge opened; StepUpDialog replays it.
      } catch (error) {
        pushToast(errorMessage(error), "warn")
        setReplay(null)
      }
    })()
  }

  /** Fire the supersede through the server step-up guard; a 403 opens StepUpDialog. */
  function submitSupersede(id: string, value: string, reason: string) {
    setFlow(null)
    setReplay({ kind: "supersede", value })
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          supersede.mutateAsync({ id, reason })
        )
        if (ok) {
          pushToast(`Unblocked · ${value}`, "ok")
          setReplay(null)
        }
        // ok === false → a step-up challenge opened; StepUpDialog replays it.
      } catch (error) {
        pushToast(errorMessage(error), "warn")
        setReplay(null)
      }
    })()
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Blocked list
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Blocked users, addresses and banks. Nothing is deleted — entries are
            superseded.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex h-[38px] flex-none items-center gap-[7px] rounded-[11px] bg-btn-dark px-[15px] text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          + Add entry
        </button>
      </div>

      {/* ── Blocked table ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Column header row */}
        <div
          className={`grid ${BLOCKED_GRID} gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
        >
          <div>Kind</div>
          <div>Value</div>
          <div>Reason</div>
          <div>Added</div>
          <div aria-hidden="true" />
        </div>

        {list.isLoading && <LoadingRows />}

        {list.isError && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[13px] font-bold text-tdn">
              Failed to load the blocked list
            </p>
            <button
              type="button"
              onClick={() => void list.refetch()}
              className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {list.isSuccess && entries.length === 0 && (
          <div className="px-[18px] py-10 text-center text-[12.5px] text-ink3">
            Nothing blocked. No users, addresses or banks are on the list.
          </div>
        )}

        {list.isSuccess &&
          entries.map((entry) => (
            <BlockedRow
              key={entry.id}
              entry={entry}
              onUnblock={() =>
                setFlow({
                  id: entry.id,
                  value: entry.value,
                  reason: "",
                  step: "reason",
                })
              }
            />
          ))}
      </div>

      {/* ── Add entry (purpose-built dialog collects the value) ────────────── */}
      <AddBlockedDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        denylist={denylist}
        onSave={onDialogSave}
      />

      {/* ── Add reason (audited) → step-up-guarded POST ────────────────────── */}
      <ReasonModal
        open={pendingAdd !== null}
        onOpenChange={(next) => !next && setPendingAdd(null)}
        title={
          pendingAdd
            ? `Add to blocked list — ${pendingAdd.value}`
            : "Add to blocked list"
        }
        onContinue={(reason) =>
          pendingAdd && submitAdd(pendingAdd.value, reason)
        }
      />

      {/* ── Unblock flow: reason (audited) → step-up (client TOTP) → POST ───── */}
      <ReasonModal
        open={flow?.step === "reason"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={flow ? `Unblock — ${flow.value}` : "Unblock"}
        onContinue={(reason) =>
          flow && setFlow({ ...flow, reason, step: "stepup" })
        }
      />
      <StepUpModal
        open={flow?.step === "stepup"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={flow ? `Unblock — ${flow.value}` : "Unblock"}
        onComplete={() =>
          flow && submitSupersede(flow.id, flow.value, flow.reason)
        }
      />

      {/* Server-side step-up re-auth: a 403 on either POST opens this; the POST
          replays after re-authentication, then toasts. */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((ok) => {
              if (ok && replay) {
                pushToast(
                  replay.kind === "add"
                    ? `Added to blocked list · ${replay.value}`
                    : `Unblocked · ${replay.value}`,
                  "ok"
                )
              }
              setReplay(null)
            })
            .catch((error) => {
              pushToast(errorMessage(error), "warn")
              setReplay(null)
            })
        }}
      />
    </div>
  )
}

/**
 * One deny-list row. An active entry offers the Unblock action; a superseded entry
 * (append-only history, §3.4) renders dimmed with a "Superseded" marker and no
 * action — nothing is ever deleted.
 */
function BlockedRow({
  entry,
  onUnblock,
}: {
  entry: BlockedEntry
  onUnblock: () => void
}) {
  const superseded = entry.supersededAt !== null

  return (
    <div
      className={`grid ${BLOCKED_GRID} items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0 ${
        superseded ? "opacity-55" : ""
      }`}
    >
      {/* Kind chip */}
      <div>
        <span className="rounded-[6px] bg-card2 px-2 py-[2px] text-[10.5px] font-bold text-ink2">
          {KIND_LABEL[entry.kind]}
        </span>
      </div>

      {/* Value (mono, truncated) */}
      <div
        className="truncate font-mono text-[12px] font-semibold text-ink"
        title={entry.value}
      >
        {entry.value}
      </div>

      {/* Reason */}
      <div className="text-[12px] text-ink2">{entry.reason}</div>

      {/* Added when */}
      <div className="text-[11.5px] text-ink3">{shortDate(entry.createdAt)}</div>

      {/* Unblock (active only — superseded rows are audit history) */}
      <div className="text-right">
        {superseded ? (
          <span className="text-[11px] font-bold text-ink3">Superseded</span>
        ) : (
          <button
            type="button"
            onClick={onUnblock}
            aria-label={`Unblock ${entry.value}`}
            className="inline-flex text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Unblock
          </button>
        )}
      </div>
    </div>
  )
}
