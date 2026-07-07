"use client"

/**
 * CurrenciesPage — the Configuration group's currency-catalog screen (design §6.24).
 * Composition only: `useCurrencyCatalog` owns the real catalog read + the two
 * dual-control writes (the Live-pill toggle and the add-currency dialog); the table +
 * rows live in `components/admin/currencies/*`. Toggling a currency is a maker-checker
 * config change → the shared MakerCheckerModal → a step-up-guarded PATCH, replayed via
 * the StepUpDialog on a 403. Nothing here moves money (§3.1).
 */
import { AddCurrencyDialog } from "@/components/admin/add-currency-dialog"
import { MakerCheckerModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { CurrencyTable } from "@/components/admin/currencies/currency-table"
import { useCurrencyCatalog } from "@/lib/hooks/use-currency-catalog"

export function CurrenciesPage() {
  const c = useCurrencyCatalog()

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1000px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
              Currency catalog
            </h1>
            <p className="mt-[5px] text-[13.5px] text-ink2">
              Fiat currencies, live status, rounding and name-enquiry
              availability.
            </p>
          </div>
          <button
            type="button"
            onClick={() => c.setAddOpen(true)}
            className="shrink-0 rounded-[10px] bg-btn-dark px-3.5 py-2 text-[12.5px] font-extrabold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            New currency
          </button>
        </div>

        <CurrencyTable
          isLoading={c.isLoading}
          isError={c.isError}
          isSuccess={c.isSuccess}
          rows={c.rows}
          onToggle={c.setPending}
          onRetry={() => c.refetch()}
        />
      </div>

      {/* ── Add-currency dialog (runtime custom fiat, created disabled) ─────── */}
      <AddCurrencyDialog
        open={c.addOpen}
        onOpenChange={c.setAddOpen}
        existingCodes={c.existingCodes}
        onSave={c.saveNewCurrency}
      />

      {/* ── Maker-checker flow (design's Live-toggle destination) ───────────── */}
      <MakerCheckerModal
        open={c.pending !== null}
        onOpenChange={(open) => {
          if (!open) c.setPending(null)
        }}
        title={
          c.pending
            ? `${c.pending.live ? "Disable" : "Enable"} ${c.pending.code}`
            : "Currency change"
        }
        diff={c.diff}
        onSubmit={c.applyToggle}
      />

      {/* Server-side step-up re-auth: a 403 on the enabled PATCH opens this; the
          PATCH replays after re-authentication (the catalog then invalidates). */}
      <StepUpDialog
        open={c.stepUp.open}
        mfaEnabled={c.me.data?.mfaEnabled ?? false}
        onOpenChange={c.stepUp.setOpen}
        onSuccess={c.onStepUpSuccess}
      />
    </div>
  )
}
