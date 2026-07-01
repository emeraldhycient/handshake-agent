"use client"

/**
 * CurrenciesPage — the Configuration group's currency-catalog screen
 * (operator-console design system §6.24, `docs/design-ref/screens/Currencies.html`).
 *
 * WIRED (Phase 6b) to the real `GET /admin/config/catalog` read
 * (`useAdminCatalog`) — the FULL fiat catalog including *disabled* (Off)
 * currencies and each entry's effective live status, which the enabled-only
 * public `GET /config` cannot provide. Each `AdminCatalogFiat` (code / symbol /
 * displayName / decimals / live) maps onto a `CurrencyCatalogRow`; `decimals`
 * drives the Rounding column. The design's Name-enquiry column has NO backing
 * field in the catalog (it is not modeled server-side), so it renders the
 * design-faithful "Unavailable" until a name-enquiry read is added.
 *
 * Structure (from the exact markup): a header + a single bordered card holding a
 * 5-column grid table — Currency (34px symbol chip + code over name) · Symbol
 * (mono) · Rounding (dp, mono/tabular) · Name-enquiry (colored label) · Live
 * (clickable status pill). The design's Live pill carries an `onToggle` handler:
 * enabling / disabling a currency is a dual-control config change, so clicking it
 * opens the shared MakerCheckerModal (the actual persisted toggle is a Phase-7
 * write — this reads only, §3.1). Nothing moves money.
 */
import { useMemo, useState } from "react"

import { MakerCheckerModal } from "@/components/admin/flows"
import { Skeleton } from "@/components/ui/skeleton"
import { useAdminCatalog } from "@/lib/query/hooks"
import { pushToast } from "@/lib/store/toast-store"
import { cn } from "@/lib/utils"
import type {
  CurrencyCatalogRow,
  MakerCheckerDiffRow,
} from "@/types/components"

// Design §6.24 table grid — Currency / Symbol / Rounding / Name-enquiry / Live
// (verbatim from the markup: grid-template-columns:1.4fr 0.8fr 0.8fr 1fr 0.9fr).
const CURRENCY_GRID = "grid-cols-[1.4fr_0.8fr_0.8fr_1fr_0.9fr]"

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

export function CurrenciesPage() {
  // Real fiat catalog (full — incl. disabled/off), fetched from
  // GET /admin/config/catalog. Name-enquiry availability is not surfaced by the
  // read, so it renders the design-faithful "Unavailable" for every row.
  const { data, isLoading, isError, isSuccess, refetch } = useAdminCatalog()

  const rows = useMemo<CurrencyCatalogRow[]>(
    () =>
      (data?.fiats ?? []).map((f) => ({
        id: f.code.toLowerCase(),
        code: f.code,
        symbol: f.symbol,
        name: f.displayName,
        rounding: f.decimals,
        live: f.live,
        nameEnquiry: false,
      })),
    [data]
  )

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

  // Dual-control approved. The persisted live-status toggle is a Phase-7 write
  // (this screen reads only, §3.1); acknowledge the intent and close the modal.
  const applyToggle = () => {
    if (!pending) return
    pushToast(
      `${pending.code} · ${pending.live ? "Disable" : "Enable"} queued`,
      "info"
    )
    setPending(null)
  }

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

          {/* Loading */}
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "grid items-center gap-3 border-b border-line2 px-[18px] py-[14px]",
                  CURRENCY_GRID
                )}
                aria-busy="true"
              >
                <div className="flex items-center gap-[11px]">
                  <Skeleton className="size-[34px] flex-none rounded-[9px]" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="h-2.5 w-24" />
                  </div>
                </div>
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-10 rounded-full" />
              </div>
            ))}

          {/* Error */}
          {isError && (
            <div className="px-5 py-[52px] text-center">
              <div className="text-[14px] font-bold text-tdn">
                Couldn&apos;t load the currency catalog
              </div>
              <div className="mt-1 text-[12.5px] text-ink2">
                The catalog failed to load. Check your connection and try again.
              </div>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-3 inline-flex h-[34px] items-center rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty */}
          {isSuccess && rows.length === 0 && (
            <div className="px-5 py-[60px] text-center text-ink3">
              <div className="text-[14px] font-bold text-ink2">
                No currencies in the catalog
              </div>
              <div className="mt-1 text-[12.5px]">
                Currencies are added through the layered config.
              </div>
            </div>
          )}

          {/* Rows */}
          {isSuccess &&
            rows.map((row) => (
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
        onSubmit={applyToggle}
      />
    </div>
  )
}
