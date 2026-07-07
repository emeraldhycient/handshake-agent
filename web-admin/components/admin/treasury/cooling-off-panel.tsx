"use client"

import { BeneficiaryOverride } from "@/components/admin/beneficiary-override"
import type { CoolingOffPanelProps } from "@/types/components"

/**
 * Beneficiaries still inside their first-use cooling-off window (IDN-08). The override
 * is the step-up-gated `BeneficiaryOverride` (useOverrideCoolingOff); on success the
 * beneficiaries query is invalidated so the row clears. Only rendered when at least one
 * payout destination is still locked.
 */
export function CoolingOffPanel({ beneficiaries }: CoolingOffPanelProps) {
  return (
    <div className="mt-4 rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[13px] font-extrabold text-ink">
          Beneficiaries in cooling-off
        </div>
        <span className="text-[11px] font-semibold text-ink3">
          First-use lock · override requires step-up
        </span>
      </div>
      {beneficiaries.map((beneficiary) => (
        <div
          key={beneficiary.id}
          className="flex items-center gap-3 border-b border-line2 py-3 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-ink">
              {beneficiary.label}
            </div>
            <div className="truncate font-mono text-[11px] text-ink3">
              {beneficiary.type === "bank_account"
                ? "Bank account"
                : "USDT address"}
            </div>
          </div>
          <span className="shrink-0 rounded-md bg-swn px-2 py-[3px] text-[9.5px] font-extrabold tracking-[0.02em] text-twn uppercase">
            Cooling-off
          </span>
          <BeneficiaryOverride beneficiary={beneficiary} />
        </div>
      ))}
    </div>
  )
}
