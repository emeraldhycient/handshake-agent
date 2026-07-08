"use client"

/**
 * PricingPage — per capability × asset × currency pricing (design §6.22), WIRED to the
 * `pricing.*` registry via `useSettings("Pricing")`. Orchestrator: pulls the pricing
 * editor state machine from `usePricingEditor` and composes the spread card, the
 * base-rates surface, the add-price dialog, and the shared funds-safety edit chain
 * (value → reason → confirm → the real step-up-guarded PATCH). Every leaf DERIVES the
 * user-facing rate/margin — nothing stores a line item; nothing moves money (§3.1).
 */
import { AddPriceDialog } from "@/components/admin/add-price-dialog"
import { PricingBaseRates } from "@/components/admin/pricing-base-rates"
import { MakerCheckerModal, ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { SettingValueModal } from "@/components/admin/flows/setting-value-modal"
import { usePricingEditor } from "@/lib/hooks/use-pricing-editor"
import { SpreadCard } from "@/components/admin/pricing/spread-card"

export function PricingPage() {
  const p = usePricingEditor()

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Pricing
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Per capability × asset × currency. Versioned, schedulable,
          maker-checker. Margin is operator-only — never shown to end users.
        </p>
      </div>

      <SpreadCard
        rows={p.spreadRows}
        currencies={p.currencies}
        previewCurrency={p.previewCurrency}
        feeLabel={p.feeLabel}
        isLoading={p.query.isLoading}
        isError={p.query.isError}
        isSuccess={p.query.isSuccess}
        onCurrencyChange={p.setCurrency}
        onRetry={() => p.query.refetch()}
        onEditFee={p.onEditFee}
        onEdit={p.onEditSpread}
        onEditMin={p.onEditMin}
        onEditMax={p.onEditMax}
      />

      {/* Base rates (the "add more prices" surface) */}
      <PricingBaseRates
        rows={p.baseRateRows}
        canAdd={p.addOptions.length > 0}
        loading={p.query.isLoading}
        onEdit={p.onEditBaseRate}
        onAdd={() => p.setAddOpen(true)}
      />

      {/* Add-price value capture → hands off to the audit chain */}
      <AddPriceDialog
        open={p.addOpen}
        onOpenChange={p.setAddOpen}
        options={p.addOptions}
        onContinue={p.onAddContinue}
      />

      {/* Funds-safety flow chain: value → reason → confirm. The REAL step-up is
          server-driven — the PATCH 403s and the StepUpDialog below replays it. */}
      <SettingValueModal
        open={p.step === "value"}
        onOpenChange={(next) => (next ? undefined : p.closeFlow())}
        title={p.flowTitle}
        fieldLabel={p.target?.fieldLabel ?? "New value"}
        currentValue={p.target?.currentLabel ?? ""}
        value={p.newValue}
        onValueChange={p.setNewValue}
        canContinue={p.parsed !== null}
        onContinue={p.onValueContinue}
      />
      <ReasonModal
        open={p.step === "reason"}
        onOpenChange={(next) => (next ? undefined : p.closeFlow())}
        title={p.flowTitle}
        onContinue={p.onReasonContinue}
      />
      <MakerCheckerModal
        open={p.step === "maker"}
        onOpenChange={(next) => (next ? undefined : p.closeFlow())}
        title={p.flowTitle}
        diff={p.diff}
        onSubmit={p.approve}
      />

      {/* Server-side step-up re-auth: a 403 on the PATCH opens this; it replays after
          re-authentication (settings then invalidate). */}
      <StepUpDialog
        open={p.stepUp.open}
        mfaEnabled={p.me.data?.mfaEnabled ?? false}
        onOpenChange={p.stepUp.setOpen}
        onSuccess={p.onStepUpSuccess}
      />
    </div>
  )
}
