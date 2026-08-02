"use client"

/**
 * PricingBaseRates — the per-(asset × currency) base-rate table on the Pricing screen.
 * Base rates are the "add more prices" surface (root CLAUDE.md §7): a currency is
 * fail-closed on enablement until at least one base rate keyed by its code exists, so
 * this is where an operator prices a newly-added currency. Presentation only — it emits
 * `onEdit(row)` for an existing rate and `onAdd()` for a new pair; the parent runs the
 * shared audit chain (reason → step-up → maker-checker). Nothing moves money (§3.1).
 */
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { PricingBaseRatesProps } from "@/types"

const BASE_RATE_GRID = "grid-cols-[0.9fr_0.9fr_1.4fr_0.7fr]"

export function PricingBaseRates({
  rows,
  canAdd,
  loading,
  onEdit,
  onAdd,
}: PricingBaseRatesProps) {
  return (
    <div className="mt-6">
      {/* ── Section header + Add-price affordance ──────────────────────────────── */}
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-extrabold tracking-[-0.01em] text-ink">
            Base rates
          </h2>
          <p className="mt-[3px] text-[12.5px] text-ink2">
            Mid-market rate per asset in each currency. A currency can only go live
            once it has a base rate.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="shrink-0 rounded-[10px] bg-btn-dark px-3.5 py-2 text-[12.5px] font-extrabold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add price
        </button>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Column header row */}
        <div
          className={cn(
            "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
            BASE_RATE_GRID
          )}
        >
          <div>Asset</div>
          <div>Currency</div>
          <div>Rate</div>
          <div aria-hidden="true" />
        </div>

        {/* Loading */}
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
                BASE_RATE_GRID
              )}
              aria-busy="true"
            >
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-8 w-14 rounded-[9px]" />
            </div>
          ))}

        {/* Empty */}
        {!loading && rows.length === 0 && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[13.5px] font-bold text-ink">
              No base rates configured
            </p>
            <p className="mt-1 text-[12.5px] text-ink3">
              Add a price to make a currency transactable.
            </p>
          </div>
        )}

        {/* Data */}
        {!loading &&
          rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
                BASE_RATE_GRID
              )}
            >
              <div className="font-mono text-[12.5px] font-bold text-ink">
                {row.asset}
              </div>
              <div className="font-mono text-[12px] text-ink2">{row.code}</div>
              <div className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
                {row.label}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onEdit(row)}
                  aria-label={`Edit ${row.asset} / ${row.code} base rate`}
                  className="inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
