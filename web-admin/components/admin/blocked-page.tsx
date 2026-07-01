"use client"

/**
 * BlockedPage — the blocked-list surface, reproduced pixel-for-pixel from
 * `docs/design-ref/screens/Blocked.html` (SPEC §6.7). A title + subtitle header
 * with a dark "+ Add entry" CTA, then a single card holding a grid table:
 * Type (chip) · Value (mono) · Reason · Added by/when · Remove.
 *
 * "Blocked users, addresses and banks. Nothing is deleted — entries are
 * superseded." Over-blocking is reversible; the store is append-only.
 *
 * DESIGN REPRODUCTION (not data-wired): the design's `logic.js` has no
 * `vBlocked()` view method (truncated), so the rows are the design's own
 * representative sample, embedded as a module-level constant below — matching the
 * markup + SPEC §6.7 + the `seed()` dataset shapes (operator names like
 * "Amara Okeke", USDT `T…` addresses, NUBAN account numbers). No fetching;
 * real-data reintegration is a separate later step.
 *
 * Mutating actions match the design's two write paths:
 *  - Add → the purpose-built AddBlockedDialog (type is derived from the value
 *    shape; value + reason collected in the form), which appends the entry.
 *  - Remove → the shared funds-safety flow modals exactly as the design chains
 *    them (SPEC §5): ReasonModal (recorded in the immutable audit log) →
 *    StepUpModal (TOTP).
 * On completion the local list updates, matching the design's optimistic
 * per-row state.
 */
import { useMemo, useState } from "react"

import { AddBlockedDialog } from "@/components/admin/add-blocked-dialog"
import { ReasonModal, StepUpModal } from "@/components/admin/flows"
import { pushToast } from "@/lib/store/toast-store"
import type { BlockedEntry } from "@/types/components"

// ── The design's blocked entries (representative sample; SPEC §6.7 + seed() shapes) ──

const SEED_ENTRIES: readonly BlockedEntry[] = [
  {
    index: 0,
    type: "Address",
    value: "TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8",
    reason: "OFAC SDN-list match · sanctions screening",
    by: "Ifeoma Bello",
    when: "Jun 30",
  },
  {
    index: 1,
    type: "User",
    value: "usr_10494 · Bola Balogun",
    reason: "SIM-swap flag + velocity breach — account frozen",
    by: "Amara Okeke",
    when: "Jun 30",
  },
  {
    index: 2,
    type: "Bank",
    value: "0114227781 · Access Bank",
    reason: "Confirmed mule account (fraud report)",
    by: "Kelechi Chukwu",
    when: "Jun 28",
  },
  {
    index: 3,
    type: "Address",
    value: "0x9f2a4B7c1D8e5F0a3C6b9E2d1A4f7C0b3E6d8A21",
    reason: "Linked to phishing campaign proceeds",
    by: "Ifeoma Bello",
    when: "Jun 25",
  },
]

// Design §6.7 table grid — Type · Value · Reason · Added-by · Remove.
const BLOCKED_GRID = "grid-cols-[0.7fr_1.6fr_1.8fr_1.2fr_0.7fr]"

// The active Remove flow (mirrors the design's `runFlow` step chain): Remove is
// audited (reason) then step-up-gated. Add uses its own AddBlockedDialog.
type RemoveFlow = { index: number; step: "reason" | "stepup" } | null

/**
 * Derive the Type chip from the value's shape (heuristic — the store keeps only
 * the raw string; SPEC §6.7 + BlockedEntry.type). On-chain addresses → "Address",
 * everything else → "Identifier" (covers user/bank identifiers).
 */
function typeForValue(value: string): string {
  const v = value.trim()
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(v)
  const isTron = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)
  return isEvm || isTron ? "Address" : "Identifier"
}

export function BlockedPage() {
  const [entries, setEntries] = useState<readonly BlockedEntry[]>(SEED_ENTRIES)
  const [addOpen, setAddOpen] = useState(false)
  const [flow, setFlow] = useState<RemoveFlow>(null)

  const valueOf = useMemo(
    () => (index: number) =>
      entries.find((e) => e.index === index)?.value ?? "entry",
    [entries]
  )

  // The dialog dedupes against + appends to this array; we recover the new value
  // as the tail-of-next diff (the store is the raw string[] behind the rows).
  const denylist = useMemo(() => entries.map((e) => e.value), [entries])

  // AddBlockedDialog.onSave hands back the whole next denylist; prepend a row for
  // each value it added (design §6.7 appends the entry to the table).
  async function addFromDenylist(next: string[]) {
    const added = next.filter((v) => !denylist.includes(v))
    if (added.length === 0) return
    setEntries((prev) => {
      const startIndex = prev.reduce((max, e) => Math.max(max, e.index), -1) + 1
      const rows: BlockedEntry[] = added.map((value, i) => ({
        index: startIndex + i,
        type: typeForValue(value),
        value,
        reason: "Added to blocked list · sanctions screening",
        by: "You",
        when: "just now",
      }))
      return [...rows, ...prev]
    })
    setAddOpen(false)
    pushToast(`Added to blocked list · ${added[added.length - 1]}`, "ok")
  }

  function removeAt(index: number) {
    const removed = entries.find((e) => e.index === index)
    setEntries((prev) => prev.filter((e) => e.index !== index))
    setFlow(null)
    if (removed) pushToast(`Removed from blocked list · ${removed.value}`, "ok")
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design line 3) ─────────────────────────────────────────── */}
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

      {/* ── Blocked table (design lines 4–7) ───────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Column header row */}
        <div
          className={`grid ${BLOCKED_GRID} gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
        >
          <div>Type</div>
          <div>Value</div>
          <div>Reason</div>
          <div>Added by</div>
          <div aria-hidden="true" />
        </div>

        {entries.length === 0 ? (
          <div className="px-[18px] py-10 text-center text-[12.5px] text-ink3">
            Nothing blocked. No users, addresses or banks are on the list.
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={`${entry.index}-${entry.value}`}
              className={`grid ${BLOCKED_GRID} items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0`}
            >
              {/* Type chip */}
              <div>
                <span className="rounded-[6px] bg-card2 px-2 py-[2px] text-[10.5px] font-bold text-ink2">
                  {entry.type}
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

              {/* Added by · when */}
              <div className="text-[11.5px] text-ink3">
                {entry.by} · {entry.when}
              </div>

              {/* Remove (audited, step-up-gated) */}
              <div className="text-right">
                <button
                  type="button"
                  onClick={() =>
                    setFlow({ index: entry.index, step: "reason" })
                  }
                  aria-label={`Remove ${entry.value} from the blocked list`}
                  className="inline-flex text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Add entry (purpose-built dialog: type derived, value + reason) ──── */}
      <AddBlockedDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        denylist={denylist}
        onSave={addFromDenylist}
      />

      {/* ── Remove flow modals (shared funds-safety flows, SPEC §5) ─────────── */}
      {/* Remove → ReasonModal → StepUpModal (audited, sensitive write). */}
      <ReasonModal
        open={flow?.step === "reason"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow ? `Remove from blocked list — ${valueOf(flow.index)}` : "Remove"
        }
        onContinue={() =>
          flow && setFlow({ index: flow.index, step: "stepup" })
        }
      />
      <StepUpModal
        open={flow?.step === "stepup"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow ? `Remove from blocked list — ${valueOf(flow.index)}` : "Remove"
        }
        onComplete={() => flow && removeAt(flow.index)}
      />
    </div>
  )
}
