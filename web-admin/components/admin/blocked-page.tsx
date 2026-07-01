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
 * Mutating actions open the shared funds-safety flow modals exactly as the
 * design chains them (SPEC §5 "Flow modals"): both Add and Remove are sensitive,
 * audited, step-up-gated writes → ReasonModal (recorded in the immutable audit
 * log) → StepUpModal (TOTP). On completion the local list updates, matching the
 * design's optimistic per-row state.
 */
import { useMemo, useState } from "react"

import { ReasonModal, StepUpModal } from "@/components/admin/flows"
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

// The active mutating flow (mirrors the design's `runFlow` step chain). Both
// Add and Remove are audited (reason) then step-up-gated.
type ActiveFlow =
  | { kind: "add"; step: "reason" | "stepup" }
  | { kind: "remove"; index: number; step: "reason" | "stepup" }
  | null

export function BlockedPage() {
  const [entries, setEntries] = useState<readonly BlockedEntry[]>(SEED_ENTRIES)
  const [flow, setFlow] = useState<ActiveFlow>(null)

  const valueOf = useMemo(
    () => (index: number) =>
      entries.find((e) => e.index === index)?.value ?? "entry",
    [entries]
  )

  function removeAt(index: number) {
    setEntries((prev) => prev.filter((e) => e.index !== index))
    setFlow(null)
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
          onClick={() => setFlow({ kind: "add", step: "reason" })}
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
                    setFlow({
                      kind: "remove",
                      index: entry.index,
                      step: "reason",
                    })
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

      {/* ── Mutating flow modals (shared funds-safety flows, SPEC §5) ───────── */}

      {/* Add entry → ReasonModal → StepUpModal (audited, sensitive write). */}
      <ReasonModal
        open={flow?.kind === "add" && flow.step === "reason"}
        onOpenChange={(next) => !next && setFlow(null)}
        title="Add to blocked list"
        onContinue={() => setFlow({ kind: "add", step: "stepup" })}
      />
      <StepUpModal
        open={flow?.kind === "add" && flow.step === "stepup"}
        onOpenChange={(next) => !next && setFlow(null)}
        title="Add to blocked list"
        onComplete={() => setFlow(null)}
      />

      {/* Remove → ReasonModal → StepUpModal (audited, sensitive write). */}
      <ReasonModal
        open={flow?.kind === "remove" && flow.step === "reason"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "remove"
            ? `Remove from blocked list — ${valueOf(flow.index)}`
            : "Remove from blocked list"
        }
        onContinue={() =>
          flow?.kind === "remove" &&
          setFlow({ kind: "remove", index: flow.index, step: "stepup" })
        }
      />
      <StepUpModal
        open={flow?.kind === "remove" && flow.step === "stepup"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "remove"
            ? `Remove from blocked list — ${valueOf(flow.index)}`
            : "Remove from blocked list"
        }
        onComplete={() => flow?.kind === "remove" && removeAt(flow.index)}
      />
    </div>
  )
}
