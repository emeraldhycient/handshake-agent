"use client"

/**
 * PricingPage — per capability × asset × currency pricing (design §6.22 /
 * docs/design-ref/screens/Pricing.html).
 *
 * WIRED (Phase 6a): the pricing figures are REAL, resolved from the
 * `pricing.assets.<ASSET>.buySpreadBps` / `.sellSpreadBps` / `.baseRates.NGN` and the
 * global `pricing.processingFeeBps` registry keys via GET /admin/settings
 * (`useSettings("Pricing")`). Each priced asset (USDT/BTC/TRX) with a resolvable base
 * rate contributes a Buy row (from its buy spread) and a Sell row (from its sell
 * spread). The effective-rate preview (the NGN rate the user sees) and the amber
 * operator-only margin are DERIVED from base rate + spread + fee — never a stored line
 * item (root §3.1). The per-capability Min/max column has NO config key, so that cell
 * renders "—" (recorded as a shapeGap). Four async branches: loading / error / empty / data.
 *
 * Faithful to the design markup: a single card with the exact 7-column grid
 * `1.2fr 1fr 0.8fr 0.8fr 1fr 1.4fr 0.7fr` — Capability · Asset/ccy · Spread · Fee ·
 * Min/max · Effective-rate preview (user-sees rate + amber `--twn` margin) · Edit.
 *
 * The Edit control opens the shared funds-safety flow chain (reason → step-up TOTP →
 * maker-checker). The edit SUBMIT is a Phase-7 write; this phase wires the READ path only.
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

// The design's exact 7-column grid template (Pricing.html) — kept once and shared by
// the header row and every body row so columns line up pixel-for-pixel.
const PRICING_GRID = "grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1fr_1.4fr_0.7fr]"

// The money-path assets at launch, in display order (root §3.1 / registry PRICED_ASSETS).
const PRICED_ASSETS = ["USDT", "BTC", "TRX"] as const
// Per-capability min/max has no registry key — design-faithful placeholder (shapeGap).
const NO_MINMAX = "—"

/** One resolved pricing row (matches the Pricing.html body-row shape). */
interface PricingRow {
  /** Stable key + a11y anchor, e.g. "USDT-buy". */
  id: string
  /** Capability label (mono) — "crypto.buy" / "crypto.sell". */
  cap: string
  /** Asset / currency pairing (mono), e.g. "USDT / NGN". */
  pair: string
  /** FX spread label (e.g. "0.85%"), or "—" when the key is absent. */
  spread: string
  /** Processing-fee label (from the shared processing-fee key). */
  fee: string
  /** Per-capability min / max label (no config key yet → "—"). */
  minmax: string
  /** The NGN rate the end user sees (spread-folded), or "—" without a base rate. */
  userRate: string
  /** The operator-only margin (amber), spread + fee combined. */
  margin: string
  /** The editable spread setting key the Edit action patches (Phase 7). */
  spreadKey: string
}

/** basis points → a percentage label, e.g. 85 → "0.85%". */
function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

/** Read a numeric effective value, or null when absent / non-numeric. */
function num(setting: EffectiveSetting | undefined): number | null {
  return setting && typeof setting.value === "number" ? setting.value : null
}

/** Format an NGN rate (spread-folded) as the design's mono string. */
function ngnRate(rate: number): string {
  return `₦${rate.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Pivot the flat pricing settings into per-asset Buy + Sell rows. Buy marks the rate
 * UP by its spread (user receives less crypto); Sell marks it DOWN. The operator
 * margin folds spread + processing fee. Assets without a resolvable base rate still
 * render (with "—" for the derived rate) so the design's rows stay stable.
 */
function buildRows(settings: readonly EffectiveSetting[]): PricingRow[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  const feeBps = num(byKey.get("pricing.processingFeeBps"))
  const feeLabel = feeBps === null ? "—" : bpsToPct(feeBps)

  const rows: PricingRow[] = []
  for (const asset of PRICED_ASSETS) {
    const base = `pricing.assets.${asset}`
    const baseRate = num(byKey.get(`${base}.baseRates.NGN`))
    // Only include an asset that has at least one resolvable pricing leaf.
    const buyBps = num(byKey.get(`${base}.buySpreadBps`))
    const sellBps = num(byKey.get(`${base}.sellSpreadBps`))
    if (baseRate === null && buyBps === null && sellBps === null) continue

    const derive = (spreadBps: number | null, dir: "buy" | "sell") => {
      if (baseRate === null || spreadBps === null) return "—"
      const factor =
        dir === "buy" ? 1 + spreadBps / 10_000 : 1 - spreadBps / 10_000
      return ngnRate(baseRate * factor)
    }
    const margin = (spreadBps: number | null) => {
      const spreadPct = spreadBps === null ? 0 : spreadBps / 100
      const feePct = feeBps === null ? 0 : feeBps / 100
      return `${(spreadPct + feePct).toFixed(2)}%`
    }

    rows.push({
      id: `${asset}-buy`,
      cap: "crypto.buy",
      pair: `${asset} / NGN`,
      spread: buyBps === null ? "—" : bpsToPct(buyBps),
      fee: feeLabel,
      minmax: NO_MINMAX,
      userRate: derive(buyBps, "buy"),
      margin: margin(buyBps),
      spreadKey: `${base}.buySpreadBps`,
    })
    rows.push({
      id: `${asset}-sell`,
      cap: "crypto.sell",
      pair: `${asset} / NGN`,
      spread: sellBps === null ? "—" : bpsToPct(sellBps),
      fee: feeLabel,
      minmax: NO_MINMAX,
      userRate: derive(sellBps, "sell"),
      margin: margin(sellBps),
      spreadKey: `${base}.sellSpreadBps`,
    })
  }
  return rows
}

/** The from→to spread change a maker-checker request would apply for a row. */
function spreadDiff(
  row: PricingRow
): { field: string; from: string; to: string }[] {
  return [
    {
      field: `${row.cap} · ${row.pair} spread`,
      from: row.spread,
      to: "—",
    },
  ]
}

/** One body row of the design's pricing grid — including the inline Edit pill. */
function PricingTableRow({
  row,
  onEdit,
}: {
  row: PricingRow
  onEdit: (row: PricingRow) => void
}) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        PRICING_GRID
      )}
    >
      {/* Capability */}
      <div className="font-mono text-[12px] font-bold text-ink">{row.cap}</div>
      {/* Asset / ccy */}
      <div className="font-mono text-[11.5px] text-ink2">{row.pair}</div>
      {/* Spread */}
      <div className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
        {row.spread}
      </div>
      {/* Fee */}
      <div className="font-mono text-[11.5px] text-ink2 tabular-nums">
        {row.fee}
      </div>
      {/* Min / max */}
      <div className="font-mono text-[11px] text-ink2 tabular-nums">
        {row.minmax}
      </div>
      {/* Effective rate preview — user-sees rate + operator-only amber margin */}
      <div className="text-[11px]">
        <div className="text-ink">
          User sees{" "}
          <span className="font-mono font-bold tabular-nums">
            {row.userRate}
          </span>
        </div>
        <div className="text-twn">
          margin{" "}
          <span className="font-mono font-bold tabular-nums">{row.margin}</span>
        </div>
      </div>
      {/* Edit (opens the maker-checker flow chain) */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onEdit(row)}
          aria-label={`Edit ${row.cap} ${row.pair} spread`}
          className="inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Edit
        </button>
      </div>
    </div>
  )
}

export function PricingPage() {
  const query = useSettings("Pricing")
  const rows = useMemo(() => buildRows(query.data ?? []), [query.data])

  // The row being edited + which flow step is open (reason → step-up → maker-checker).
  const [editing, setEditing] = useState<PricingRow | null>(null)
  const [step, setStep] = useState<"reason" | "stepup" | "maker" | null>(null)

  function startEdit(row: PricingRow) {
    setEditing(row)
    setStep("reason")
  }

  function closeFlow() {
    setStep(null)
    setEditing(null)
  }

  const flowTitle = editing
    ? `Edit ${editing.cap} spread · ${editing.pair}`
    : "Edit spread"

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Pricing
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Per capability × asset × currency. Versioned, schedulable,
          maker-checker. Margin is operator-only — never shown to end users.
        </p>
      </div>

      {/* ── Pricing card (design 7-column grid table) ────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Column header row (design grid) */}
        <div
          className={cn(
            "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
            PRICING_GRID
          )}
        >
          <div>Capability</div>
          <div>Asset / ccy</div>
          <div>Spread</div>
          <div>Fee</div>
          <div>Min / max</div>
          <div>Effective rate preview</div>
          <div aria-hidden="true" />
        </div>

        {/* Loading */}
        {query.isLoading && (
          <div className="divide-y divide-line2" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "grid items-center gap-3 px-[18px] py-[13px]",
                  PRICING_GRID
                )}
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-28" />
                <Skeleton className="ml-auto h-8 w-14 rounded-[9px]" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {query.isError && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[14px] font-bold text-tdn">
              Failed to load pricing
            </p>
            <p className="mt-1 text-[12.5px] text-ink3">
              The pricing config could not be read.
            </p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {query.isSuccess && rows.length === 0 && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[14px] font-bold text-ink">No pricing rows</p>
            <p className="mt-1 text-[12.5px] text-ink3">
              No priced assets are configured.
            </p>
          </div>
        )}

        {/* Data */}
        {query.isSuccess &&
          rows.map((row) => (
            <PricingTableRow key={row.id} row={row} onEdit={startEdit} />
          ))}
      </div>

      {/* ── Funds-safety flow chain: reason → step-up → maker-checker ─────────── */}
      <ReasonModal
        open={step === "reason"}
        onOpenChange={(next) => (next ? undefined : closeFlow())}
        title={flowTitle}
        onContinue={() => setStep("stepup")}
      />
      <StepUpModal
        open={step === "stepup"}
        onOpenChange={(next) => (next ? undefined : closeFlow())}
        title={flowTitle}
        onComplete={() => setStep("maker")}
      />
      <MakerCheckerModal
        open={step === "maker"}
        onOpenChange={(next) => (next ? undefined : closeFlow())}
        title={flowTitle}
        diff={editing ? spreadDiff(editing) : []}
        onSubmit={closeFlow}
      />
    </div>
  )
}
