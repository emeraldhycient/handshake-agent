"use client"

/**
 * LimitsPage — the per-tier caps / velocity / cooling-off editor (design §6). Orchestrator:
 * pulls the editor state machine from `useLimitsEditor` and composes the loading/error
 * branches, the tier/currency board, and the shared edit chain (value → reason →
 * confirm → the real step-up-guarded PATCH). A "—" placeholder never exposes an editor
 * (§3.6); the PATCH re-validates + hot-reloads + audits server-side; nothing moves money (§3.1).
 */
import { Skeleton } from "@/components/ui/skeleton"
import { ReasonModal } from "@/components/admin/flows/reason-modal"
import { MakerCheckerModal } from "@/components/admin/flows/maker-checker-modal"
import { SettingValueModal } from "@/components/admin/flows/setting-value-modal"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useLimitsEditor } from "@/lib/hooks/use-limits-editor"
import { LimitsBoard } from "@/components/admin/limits/limits-board"
import { MIN_CHANGE_REQUEST_REASON } from "@/constants/approvals"

export function LimitsPage() {
  const l = useLimitsEditor()

  return (
    <div className="mx-auto max-w-[1080px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Limits &amp; velocity
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Per-tier caps, count caps, cooling-off and velocity windows. Changes
          apply after step-up and are audited.
        </p>
      </div>

      {l.query.isLoading && (
        <div aria-busy="true">
          <div className="mb-4 flex gap-[9px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[38px] w-[84px] rounded-[10px]" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-[14px]">
            <Skeleton className="h-64 rounded-[16px]" />
            <Skeleton className="h-64 rounded-[16px]" />
          </div>
        </div>
      )}

      {l.query.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
          <p className="text-sm font-bold text-tdn">Failed to load limits</p>
          <p className="mt-1 text-[12.5px] text-ink2">
            The tier-limit config could not be read.
          </p>
          <button
            type="button"
            onClick={() => l.query.refetch()}
            className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {l.query.isSuccess && l.tier && (
        <LimitsBoard
          tiers={l.tiers}
          tierId={l.tierId}
          onTierChange={l.setTierId}
          currencies={l.currencies}
          activeCurrency={l.activeCurrency}
          onCurrencyChange={l.setCurrency}
          tier={l.tier}
          onEdit={l.startEdit}
        />
      )}

      {/* Edit flow: new value → reason → dual-control. Submitting RAISES a four-eyes
          tier_override ChangeRequest — it does not apply. The REAL step-up is
          server-driven — the raise 403s and the StepUpDialog below replays it. */}
      <SettingValueModal
        open={l.flow === "value"}
        onOpenChange={(open) => (open ? l.setFlow("value") : l.closeFlow())}
        title={l.flowTitle}
        fieldLabel={l.fieldLabel}
        currentValue={l.currentValue}
        value={l.newValue}
        onValueChange={l.setNewValue}
        canContinue={l.parsed !== null}
        onContinue={() => l.setFlow("reason")}
      />
      <ReasonModal
        open={l.flow === "reason"}
        onOpenChange={(open) => (open ? l.setFlow("reason") : l.closeFlow())}
        title={l.flowTitle}
        minLength={MIN_CHANGE_REQUEST_REASON}
        onContinue={l.onReasonContinue}
      />
      <MakerCheckerModal
        open={l.flow === "maker"}
        onOpenChange={(open) => (open ? l.setFlow("maker") : l.closeFlow())}
        title="Update limit"
        diff={l.makerDiff}
        mode="dual-control"
        onSubmit={l.applyEdit}
      />

      {/* Server-side step-up re-auth: a 403 on the raise opens this; it replays on re-auth. */}
      <StepUpDialog
        open={l.stepUp.open}
        mfaEnabled={l.me.data?.mfaEnabled ?? false}
        onOpenChange={l.stepUp.setOpen}
        onSuccess={l.onStepUpSuccess}
      />
    </div>
  )
}
