"use client"

/**
 * CurrenciesPage — the Configuration group's currency-catalog screen
 * (operator-console design system §6.24, `docs/design-ref/screens/Currencies.html`).
 *
 * PIXEL-FOR-PIXEL design reproduction. This screen intentionally renders the
 * design's OWN mock currency seed (`docs/design-ref/logic.js` `currencies`,
 * lines 126-130) — NGN / RWF / GHS — so it looks exactly like the imported design.
 * Real-data reintegration (`GET /config`) is a separate later step; there is no
 * `useQuery`/data-fetch here.
 *
 * Structure (from the exact markup): a header + a single bordered card holding a
 * 5-column grid table — Currency (34px symbol chip + code over name) · Symbol
 * (mono) · Rounding (dp, mono/tabular) · Name-enquiry (colored label) · Live
 * (clickable status pill). The design's Live pill carries an `onToggle` handler:
 * enabling / disabling a currency is a dual-control config change, so clicking it
 * opens the shared MakerCheckerModal (the design's destination). Nothing moves
 * money (§3.1).
 */
import { useState } from "react"

import { MakerCheckerModal } from "@/components/admin/flows"
import { cn } from "@/lib/utils"
import type {
  CurrencyCatalogRow,
  MakerCheckerDiffRow,
} from "@/types/components"

// Design §6.24 table grid — Currency / Symbol / Rounding / Name-enquiry / Live
// (verbatim from the markup: grid-template-columns:1.4fr 0.8fr 0.8fr 1fr 0.9fr).
const CURRENCY_GRID = "grid-cols-[1.4fr_0.8fr_0.8fr_1fr_0.9fr]"

// The design's own mock seed (logic.js `currencies`, lines 126-130) — reproduced
// verbatim so the screen shows the exact same rows/values as the design.
const CURRENCY_ROWS: readonly CurrencyCatalogRow[] = [
  {
    id: "ngn",
    code: "NGN",
    symbol: "₦",
    name: "Nigerian Naira",
    live: true,
    rounding: 2,
    nameEnquiry: true,
  },
  {
    id: "rwf",
    code: "RWF",
    symbol: "FRw",
    name: "Rwandan Franc",
    live: false,
    rounding: 0,
    nameEnquiry: false,
  },
  {
    id: "ghs",
    code: "GHS",
    symbol: "₵",
    name: "Ghanaian Cedi",
    live: false,
    rounding: 2,
    nameEnquiry: false,
  },
] as const

/** One catalog row — matches the design markup exactly (grid, chip, mono, pills). */
function CurrencyRow({
  row,
  onToggle,
}: {
  row: CurrencyCatalogRow
  onToggle: (row: CurrencyCatalogRow) => void
}) {
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
          <div className="text-[13px] font-bold text-ink">{row.code}</div>
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
           sole signal, root §13.8) ─────────────────────────────────────────── */}
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

export function CurrenciesPage() {
  // Which currency's Live toggle is pending dual-control approval (drives the modal).
  const [pending, setPending] = useState<CurrencyCatalogRow | null>(null)

  const diff: MakerCheckerDiffRow[] = pending
    ? [
        {
          field: `${pending.code} · live`,
          from: pending.live ? "Live" : "Off",
          to: pending.live ? "Off" : "Live",
        },
      ]
    : []

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1000px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-4">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Currency catalog
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Fiat currencies, live status, rounding and name-enquiry
            availability.
          </p>
        </div>

        {/* ── Table card ────────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-[16px] border border-line bg-card">
          {/* Column header row (design grid) */}
          <div
            className={cn(
              "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
              CURRENCY_GRID
            )}
          >
            <div>Currency</div>
            <div>Symbol</div>
            <div>Rounding</div>
            <div>Name-enquiry</div>
            <div>Live</div>
          </div>
          {CURRENCY_ROWS.map((row) => (
            <CurrencyRow key={row.id} row={row} onToggle={setPending} />
          ))}
        </div>
      </div>

      {/* ── Maker-checker flow (design's Live-toggle destination) ───────────── */}
      <MakerCheckerModal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={
          pending
            ? `${pending.live ? "Disable" : "Enable"} ${pending.code}`
            : "Currency change"
        }
        diff={diff}
        onSubmit={() => setPending(null)}
      />
    </div>
  )
}
