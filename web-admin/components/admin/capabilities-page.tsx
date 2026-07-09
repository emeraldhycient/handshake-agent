"use client"

/**
 * CapabilitiesPage — the service-registry master switchboard (design §6.25), WIRED to
 * `useSettings("Catalog")`. Orchestrator: pulls the kill-switch state machine from
 * `useCapabilityToggles` and composes the header, the four async branches over the
 * capability rows, and the shared maker-checker + step-up modals. Toggling is a
 * kill-switch — dual-control, never a direct flip; nothing moves money (§3.1).
 */
import { useCapabilityToggles } from "@/lib/hooks/use-capability-toggles"
import { MakerCheckerModal, ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { CapabilityRowCard } from "@/components/admin/capabilities/capability-row-card"
import { MIN_CHANGE_REQUEST_REASON } from "@/constants/approvals"

export function CapabilitiesPage() {
  const c = useCapabilityToggles()

  return (
    <div className="mx-auto w-full max-w-[1000px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Capabilities / service registry
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Master switchboard. Each capability is bound to a provider port.
          Toggling is a kill-switch — maker-checker with dependency warnings.
        </p>
      </div>

      {c.query.isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px] rounded-[16px]" />
          ))}
        </div>
      )}

      {c.query.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
          <p className="text-sm font-bold text-tdn">
            Failed to load capabilities
          </p>
          <p className="mt-1 text-[12.5px] text-ink2">
            The capability registry could not be read.
          </p>
          <button
            type="button"
            onClick={() => c.query.refetch()}
            className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {c.query.isSuccess && c.rows.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-6 text-center">
          <p className="text-sm font-bold text-ink">No capabilities</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            No capability flags are registered.
          </p>
        </div>
      )}

      {c.query.isSuccess && c.rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {c.rows.map((row) => (
            <CapabilityRowCard
              key={row.id}
              row={row}
              onToggle={(r) => c.openToggle(r.id)}
            />
          ))}
        </div>
      )}

      {/* Kill-switch flip chain: reason → dual-control. Submitting RAISES a four-eyes
          capability_flip ChangeRequest — it does not flip the switch directly. */}
      <ReasonModal
        open={c.step === "reason"}
        onOpenChange={(open) => !open && c.closeToggle()}
        title={
          c.pending
            ? `${c.pending.on ? "Disable" : "Enable"} ${c.pending.label}`
            : "Toggle capability"
        }
        minLength={MIN_CHANGE_REQUEST_REASON}
        onContinue={c.onReasonContinue}
      />
      <MakerCheckerModal
        open={c.step === "maker"}
        onOpenChange={(open) => !open && c.closeToggle()}
        title={
          c.pending
            ? `${c.pending.on ? "Disable" : "Enable"} ${c.pending.label}`
            : "Toggle capability"
        }
        diff={c.diff}
        mode="dual-control"
        onSubmit={c.approveToggle}
      />

      {/* Server-side step-up re-auth: a 403 on the capability raise opens this. */}
      <StepUpDialog
        open={c.stepUp.open}
        mfaEnabled={c.me.data?.mfaEnabled ?? false}
        onOpenChange={c.stepUp.setOpen}
        onSuccess={c.onStepUpSuccess}
      />
    </div>
  )
}
