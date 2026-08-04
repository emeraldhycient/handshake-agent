"use client"

import { cn } from "@/lib/utils"
import { NativeSelect } from "@/components/ui/native-select"
import { LimitLeafRow } from "@/components/admin/limits/limit-leaf-row"
import type { LimitsBoardProps } from "@/types"

/** The limits data board: the tier tabs + currency selector over the amount/velocity cards. */
export function LimitsBoard({
  tiers,
  tierId,
  onTierChange,
  currencies,
  activeCurrency,
  onCurrencyChange,
  tier,
  onEdit,
}: LimitsBoardProps) {
  return (
    <>
      {/* Currency selector + tier tabs */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="KYC tier" className="flex gap-[9px]">
          {tiers.map((t) => {
            const active = t.id === tierId
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTierChange(t.id)}
                className={cn(
                  "cursor-pointer rounded-[10px] border px-4 py-[9px] text-[12.5px] font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active
                    ? "border-btn-dark bg-btn-dark text-white"
                    : "border-line bg-card text-ink2 hover:bg-hov"
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-2 text-[12px] font-bold text-ink2">
          Currency
          <NativeSelect
            aria-label="Limits currency"
            value={activeCurrency}
            onChange={(e) => onCurrencyChange(e.target.value)}
            className="h-[36px] w-[110px]"
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>

      {/* Cards: Amount caps | Velocity & counts */}
      <div className="grid grid-cols-2 gap-[14px]">
        <section className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
          <h2 className="mb-3 text-[13px] font-extrabold text-ink">
            Amount caps · {activeCurrency} {tier.label}
          </h2>
          {tier.amountCaps.map((row) => (
            <LimitLeafRow key={row.k} row={row} onEdit={onEdit} />
          ))}
        </section>

        <section className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
          <h2 className="mb-3 text-[13px] font-extrabold text-ink">
            Velocity &amp; counts · {activeCurrency} {tier.label}
          </h2>
          {tier.velocity.map((row) => (
            <LimitLeafRow key={row.k} row={row} onEdit={onEdit} />
          ))}
        </section>
      </div>
    </>
  )
}
