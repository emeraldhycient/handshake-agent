"use client"

/**
 * BlockedPage — the deny-list surface (SPEC §6.7), WIRED to `useBlockedList`.
 * Orchestrator: pulls the append-only add/supersede state machine from
 * `useBlockedMutations` and composes the header, the deny-list table, and the shared
 * funds-safety flow modals (add: dialog → reason → step-up; unblock: reason → step-up).
 * Nothing is deleted — lifting a block SUPERSEDES the row (§3.4); nothing moves money (§3.1).
 */
import { useBlockedMutations } from "@/lib/hooks/use-blocked-mutations"
import { AddBlockedDialog } from "@/components/admin/add-blocked-dialog"
import { ReasonModal, StepUpModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { BlockedTable } from "@/components/admin/blocked/blocked-table"

export function BlockedPage() {
  const b = useBlockedMutations()

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
          onClick={() => b.setAddOpen(true)}
          className="flex h-[38px] flex-none items-center gap-[7px] rounded-[11px] bg-btn-dark px-[15px] text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          + Add entry
        </button>
      </div>

      <BlockedTable
        entries={b.entries}
        isLoading={b.list.isLoading}
        isError={b.list.isError}
        isSuccess={b.list.isSuccess}
        onRetry={() => void b.list.refetch()}
        onUnblock={(entry) =>
          b.setFlow({
            id: entry.id,
            value: entry.value,
            reason: "",
            step: "reason",
          })
        }
      />

      {/* ── Add entry (purpose-built dialog collects the value) ────────────── */}
      <AddBlockedDialog
        open={b.addOpen}
        onOpenChange={b.setAddOpen}
        denylist={b.denylist}
        onSave={b.onDialogSave}
      />

      {/* ── Add reason (audited) → step-up-guarded POST ────────────────────── */}
      <ReasonModal
        open={b.pendingAdd !== null}
        onOpenChange={(next) => !next && b.setPendingAdd(null)}
        title={
          b.pendingAdd
            ? `Add to blocked list — ${b.pendingAdd.value}`
            : "Add to blocked list"
        }
        onContinue={(reason) =>
          b.pendingAdd && b.submitAdd(b.pendingAdd.value, reason)
        }
      />

      {/* ── Unblock flow: reason (audited) → step-up (client TOTP) → POST ───── */}
      <ReasonModal
        open={b.flow?.step === "reason"}
        onOpenChange={(next) => !next && b.setFlow(null)}
        title={b.flow ? `Unblock — ${b.flow.value}` : "Unblock"}
        onContinue={(reason) =>
          b.flow && b.setFlow({ ...b.flow, reason, step: "stepup" })
        }
      />
      <StepUpModal
        open={b.flow?.step === "stepup"}
        onOpenChange={(next) => !next && b.setFlow(null)}
        title={b.flow ? `Unblock — ${b.flow.value}` : "Unblock"}
        onComplete={() =>
          b.flow && b.submitSupersede(b.flow.id, b.flow.value, b.flow.reason)
        }
      />

      {/* Server-side step-up re-auth: a 403 on either POST opens this; the POST
          replays after re-authentication, then toasts. */}
      <StepUpDialog
        open={b.stepUp.open}
        mfaEnabled={b.me.data?.mfaEnabled ?? false}
        onOpenChange={b.stepUp.setOpen}
        onSuccess={b.onStepUpSuccess}
      />
    </div>
  )
}
