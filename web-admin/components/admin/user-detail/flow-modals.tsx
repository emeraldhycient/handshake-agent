"use client"

/**
 * UserDetailFlowModals — the credit → reason → engine / maker step sequence plus the
 * shared server-driven step-up dialog. It renders whichever modal the flow's
 * `current` step selects; the credit-preview tables derive from the captured
 * `creditInput` (never hardcoded). §3.1: nothing here moves money — the manual credit
 * and the tier override raise a four-eyes ChangeRequest a SECOND admin approves, and
 * the KYC approve applies immediately after server step-up. The REAL step-up is
 * server-driven: a sensitive mutation 403s → StepUpDialog → the stashed action replays.
 */
import {
  EngineActionModal,
  MakerCheckerModal,
  ManualCreditModal,
  ReasonModal,
} from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { SupportedAssetSchema } from "@handshake-agent/contracts"
import type { SupportedAsset } from "@handshake-agent/contracts"
import { creditFlowRows, creditableAssetsFor } from "@/lib/users/user-detail"
import type { UserDetailFlowModalsProps } from "@/types"

export function UserDetailFlowModals({
  userId,
  balances,
  current,
  flow,
  creditInput,
  setCreditInput,
  creditInputRef,
  advance,
  cancelFlow,
  stepUp,
  mfaEnabled,
  onStepUpSuccess,
}: UserDetailFlowModalsProps) {
  const creditableAssets = creditableAssetsFor(balances)
  const {
    effect: creditEffect,
    ledger: creditLedger,
    diff: creditDiff,
  } = creditFlowRows(creditInput, userId)
  const isCreditFlow = flow?.steps[0] === "credit"

  return (
    <>
      {/* FLOW MODALS (credit → reason → engine / maker; the REAL step-up is
             server-driven — 403 → StepUpDialog → replay) */}
      <ManualCreditModal
        open={current === "credit"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? "Manual credit"}
        assets={creditableAssets}
        onContinue={(asset, amount) => {
          // `asset` is one of `creditableAssets` (all SupportedAsset); parse to
          // narrow the type — falls back to USDT if somehow off-list (never fires).
          const parsed = SupportedAssetSchema.safeParse(asset)
          const input = {
            asset: parsed.success ? parsed.data : ("USDT" as SupportedAsset),
            amount,
          }
          setCreditInput(input)
          creditInputRef.current = input
          advance()
        }}
      />
      <ReasonModal
        open={current === "reason"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        onContinue={(reason) => advance(reason)}
      />
      <EngineActionModal
        open={current === "engine"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        effect={isCreditFlow ? creditEffect : (flow?.effect ?? [])}
        ledger={isCreditFlow ? creditLedger : (flow?.ledger ?? [])}
        idempotencyKey="idem_9f31c0a2"
        cta="Execute via engine"
        onExecute={() => advance()}
      />
      <MakerCheckerModal
        open={current === "maker"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        diff={isCreditFlow ? creditDiff : (flow?.diff ?? [])}
        onSubmit={() => advance()}
        // The manual credit AND the per-user tier override raise a REAL four-eyes
        // ChangeRequest (dual-control); the KYC approve applies immediately after
        // server step-up, so its confirm carries the honest immediate copy.
        mode={isCreditFlow || flow?.dualControl ? "dual-control" : "immediate"}
      />

      {/* Server-driven step-up: a sensitive mutation that 403s with
          ADMIN_STEP_UP_REQUIRED opens this re-auth dialog; on success the stashed
          mutation replays. Shared by every KYC + account action on this screen. */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={mfaEnabled}
        onOpenChange={stepUp.setOpen}
        onSuccess={onStepUpSuccess}
      />
    </>
  )
}
