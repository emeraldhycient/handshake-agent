"use client"

/**
 * PricingPage — per capability × asset × currency pricing (design §6.22 /
 * docs/design-ref/screens/Pricing.html).
 *
 * DESIGN REPRODUCTION ONLY. This screen renders the design's OWN representative
 * content from a module-level `const` — it does NOT fetch real config (no
 * TanStack Query / useSettings here); real-data reintegration is a separate later
 * step. The values below mirror the design markup's five pricing leaves and the
 * seed() dataset shapes (docs/design-ref/logic.js): per-asset Buy/Sell spreads,
 * the effective NGN rate the user sees, and the amber operator-only margin.
 *
 * Faithful to the design markup: a single card with the exact 7-column grid
 * `1.2fr 1fr 0.8fr 0.8fr 1fr 1.4fr 0.7fr` — Capability · Asset/ccy · Spread · Fee ·
 * Min/max · Effective-rate preview (user-sees rate + amber `--twn` margin) · Edit.
 * The margin is operator-only, never shown to end users (root §3.1).
 *
 * The Edit control opens the shared funds-safety flow chain exactly as the design
 * does: reason (immutable audit) → step-up TOTP → maker-checker (dual control, the
 * spread change enters Pending approval before it takes effect — §7). Wrapped in
 * RequireAuth + AppShell upstream; presentation only (submit is a no-op stub).
 */
import { useState } from "react"

import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { cn } from "@/lib/utils"

// The design's exact 7-column grid template (Pricing.html) — kept once and shared by
// the header row and every body row so columns line up pixel-for-pixel.
const PRICING_GRID = "grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1fr_1.4fr_0.7fr]"

/** One design-reproduction pricing row (matches Pricing.html `pricingRows`). */
interface PricingRow {
  /** Stable key + a11y anchor, e.g. "USDT-buy". */
  id: string
  /** Capability label (mono) — the design's `p.cap`. */
  cap: string
  /** Asset / currency pairing (mono) — `p.pair`. */
  pair: string
  /** FX spread label — `p.spread` (e.g. "0.85%"). */
  spread: string
  /** Processing-fee label — `p.fee`. */
  fee: string
  /** Per-capability min / max label — `p.minmax`. */
  minmax: string
  /** The NGN rate the end user sees (spread-folded) — `p.userRate`. */
  userRate: string
  /** The operator-only margin (amber) — `p.margin`. */
  margin: string
}

// The design's five pricing leaves (hint-placeholder-count="5"). Values mirror the
// seed() dataset: USDT/BTC/TRX buy & sell spreads, the effective NGN rate the user
// sees, and the operator-only margin. Representative content — reproduces the design.
const PRICING_ROWS: readonly PricingRow[] = [
  {
    id: "USDT-buy",
    cap: "crypto.buy",
    pair: "USDT / NGN",
    spread: "1.10%",
    fee: "0.50%",
    minmax: "₦2,000 – ₦2,000,000",
    userRate: "₦1,672.40",
    margin: "1.60%",
  },
  {
    id: "USDT-sell",
    cap: "crypto.sell",
    pair: "USDT / NGN",
    spread: "0.85%",
    fee: "0.50%",
    minmax: "₦2,000 – ₦2,000,000",
    userRate: "₦1,627.90",
    margin: "1.35%",
  },
  {
    id: "TRX-buy",
    cap: "crypto.buy",
    pair: "TRX / NGN",
    spread: "1.25%",
    fee: "0.50%",
    minmax: "₦2,000 – ₦1,000,000",
    userRate: "₦248.60",
    margin: "1.75%",
  },
  {
    id: "TRX-sell",
    cap: "crypto.sell",
    pair: "TRX / NGN",
    spread: "0.95%",
    fee: "0.50%",
    minmax: "₦2,000 – ₦1,000,000",
    userRate: "₦241.30",
    margin: "1.45%",
  },
  {
    id: "USDT-send",
    cap: "crypto.send",
    pair: "USDT / TRON",
    spread: "—",
    fee: "1.00 USDT",
    minmax: "5 – 50,000 USDT",
    userRate: "1.00 USDT + fee",
    margin: "0.00%",
  },
] as const

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
        {PRICING_ROWS.map((row) => (
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
