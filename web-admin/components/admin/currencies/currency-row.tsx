import { cn } from "@/lib/utils"
import { CURRENCY_GRID } from "@/constants/currencies"
import type { CurrencyRowProps } from "@/types"

/** One catalog row — matches the design markup exactly (grid, chip, mono, pills). */
export function CurrencyRow({ row, onToggle }: CurrencyRowProps) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[14px]",
        CURRENCY_GRID
      )}
    >
      {/* ── Currency: 34px symbol chip + code over name ─────────────────────── */}
      <div className="flex items-center gap-[11px]">
        <span
          aria-hidden="true"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-card2 text-sm font-extrabold text-ink"
        >
          {row.symbol}
        </span>
        <div>
          <div className="flex items-center gap-[6px]">
            <span className="text-[13px] font-bold text-ink">{row.code}</span>
            {row.custom && (
              <span className="rounded-full bg-card2 px-[6px] py-px text-[9px] font-bold tracking-[0.04em] text-ink3 uppercase">
                Custom
              </span>
            )}
          </div>
          <div className="text-[11px] text-ink3">{row.name}</div>
        </div>
      </div>

      {/* ── Symbol (mono) ────────────────────────────────────────────────────── */}
      <div className="font-mono text-[13px] text-ink">{row.symbol}</div>

      {/* ── Rounding (dp) — mono / tabular ───────────────────────────────────── */}
      <div className="font-mono text-[12px] text-ink2 tabular-nums">
        {row.rounding} dp
      </div>

      {/* ── Name-enquiry (color-coded, with a text label — colour is never the
           sole signal, root §13.8). Not surfaced by the catalog read, so this
           shows the design-faithful "Unavailable" for every row. ───────────── */}
      <div>
        <span
          className={cn(
            "text-[11px] font-bold",
            row.nameEnquiry ? "text-tok" : "text-ink3"
          )}
        >
          {row.nameEnquiry ? "Available" : "Unavailable"}
        </span>
      </div>

      {/* ── Live — clickable status pill (design `onToggle`); toggling a currency
           is a maker-checker config change → opens the MakerCheckerModal ─────── */}
      <div>
        <button
          type="button"
          onClick={() => onToggle(row)}
          aria-label={`${row.live ? "Disable" : "Enable"} ${row.code}`}
          className="cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span
            className={cn(
              "rounded-full px-[10px] py-[3px] text-[10.5px] font-bold",
              row.live ? "bg-sok text-tok" : "bg-card2 text-ink3"
            )}
          >
            {row.live ? "Live" : "Off"}
          </span>
        </button>
      </div>
    </div>
  )
}
