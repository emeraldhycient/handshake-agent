"use client"

/**
 * TreasuryPage — the treasury oversight surface (design §6.13), WIRED to the seven live
 * treasury reads. Orchestrator: pulls the view-model + payout-approval state machine from
 * `useTreasury` and composes the alert banner, the 4-up balance row, the payout /
 * sweeps grid, the cooling-off panel, and the shared maker-checker + step-up modals.
 * Funds-safety (§3.1): nothing here moves money — approving raises a four-eyes change
 * request a second admin confirms; the mutation is step-up-gated.
 */
import { MakerCheckerModal, ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useTreasury } from "@/lib/hooks/use-treasury"
import { TreasuryAlertBanner } from "@/components/admin/treasury/treasury-alert-banner"
import { BalanceCardsRow } from "@/components/admin/treasury/balance-cards-row"
import { PayoutQueuePanel } from "@/components/admin/treasury/payout-queue-panel"
import { SweepsPanel } from "@/components/admin/treasury/sweeps-panel"
import { CoolingOffPanel } from "@/components/admin/treasury/cooling-off-panel"

export function TreasuryPage() {
  const t = useTreasury()

  return (
    <div className="mx-auto w-full max-w-[1300px] flex-1 overflow-y-auto p-[26px_30px_60px]">
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Treasury
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Custodial wallet balances, fiat float, FX position and the payout
          approval queue.
        </p>
      </div>

      {t.topAlert && <TreasuryAlertBanner alert={t.topAlert} />}

      <BalanceCardsRow
        cards={t.cards}
        isLoading={t.cardsLoading}
        isError={t.cardsError}
        onRetry={t.refetchCards}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <PayoutQueuePanel
          payouts={t.payouts}
          isLoading={t.payoutQuery.isLoading}
          isError={t.payoutQuery.isError}
          approved={t.approved}
          onRetry={() => void t.payoutQuery.refetch()}
          onApprove={t.onApprove}
        />
        <SweepsPanel
          sweeps={t.sweeps}
          threshold={t.sweepThreshold}
          isLoading={t.sweepsQuery.isLoading}
          isError={t.sweepsQuery.isError}
          onRetry={() => void t.sweepsQuery.refetch()}
        />
      </div>

      {t.coolingOff.length > 0 && (
        <CoolingOffPanel beneficiaries={t.coolingOff} />
      )}

      {/* Payout approval flow (WIRED): reason (audit) → maker-checker → the REAL approve
          mutation (step-up-gated). Raising the approval releases NO money (§3.1). */}
      <ReasonModal
        open={t.flow === "reason"}
        onOpenChange={(open) => (open ? undefined : t.closeFlow())}
        title={t.active ? `Approve payout ${t.active.ref}` : "Approve payout"}
        onContinue={(r, category) =>
          t.captureReason(category ? `${category}: ${r}` : r)
        }
      />
      <MakerCheckerModal
        open={t.flow === "maker"}
        onOpenChange={(open) => (open ? undefined : t.closeFlow())}
        title={t.active ? `Approve payout ${t.active.ref}` : "Approve payout"}
        diff={t.makerDiff}
        onSubmit={t.submitApprove}
        // Approving raises a REAL four-eyes payout_release ChangeRequest a
        // second admin confirms (§3.1) — the dual-control copy is honest here.
        mode="dual-control"
      />

      {/* Real step-up: opened when the approve mutation 403s; replays on re-auth. */}
      <StepUpDialog
        open={t.stepUp.open}
        mfaEnabled={t.me.data?.mfaEnabled ?? false}
        onOpenChange={t.stepUp.setOpen}
        onSuccess={t.onStepUpSuccess}
      />
      {t.localError && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
          {t.localError}
        </p>
      )}
    </div>
  )
}
