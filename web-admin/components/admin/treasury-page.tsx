"use client"

/**
 * TreasuryPage — the treasury oversight surface (design §6.13 Treasury), a
 * pixel-faithful reproduction of `docs/design-ref/screens/Treasury.html`:
 *
 *   • an optional low-float amber warning banner,
 *   • a 4-up balance-card row whose first tile is the dark-green custodial hero
 *     (custodial USDT, NGN fiat float, FX position, exposure headroom),
 *   • a 1.5fr / 1fr grid: the payout / withdrawal approval queue (maker-checker
 *     tag + Approve on large payouts) alongside the child-address sweeps list
 *     (+ the 25 TRX sweep threshold footer).
 *
 * This is the DESIGN-REPRODUCTION build (root §13): the screen renders the design's
 * own representative mock content from module-level constants — it does NOT fetch or
 * wire real API data (that is a separate later step). The `logic.js` view method is
 * truncated, so the sample content matches the exact markup + SPEC §6.13 + the
 * `seed()` dataset shapes (operator names like "Amara Okeke", TRON child addresses).
 *
 * Funds-safety (root §3.1): nothing here moves money. "Approve" opens the shared
 * flow modals — large payouts route through maker-checker (dual-control) → step-up;
 * smaller ones through step-up — matching the design's `p.big` maker-checker gate.
 */
import { useState } from "react"

import { MakerCheckerModal, StepUpModal } from "@/components/admin/flows"
import type {
  MakerCheckerDiffRow,
  TreasuryCard,
  TreasuryPayoutRow,
  TreasurySweepRow,
} from "@/types/components"

// ── Brand constants (the only permitted non-token colour source, §7) ──────────────
// The custodial hero tile is a dark-green gradient identical in both themes (§5 KPI
// hero); the delta-dot on the hero is amber.
const HERO_GRADIENT =
  "linear-gradient(150deg, var(--brand-green) 0%, var(--brand-green-deep) 100%)"

// ── Design-faithful sample data (no API — see file header) ────────────────────────

/**
 * The 4-up balance-card row (design markup line 6, `treasuryCards`). Tile 0 is the
 * dark-green custodial hero; tiles 1–3 are neutral `--card` tiles. Colours are
 * expressed as tokens via each tile's `tone`, never raw hex.
 */
const TREASURY_CARDS: readonly TreasuryCard[] = [
  {
    id: "custodial-usdt",
    tone: "hero",
    label: "Custodial · USDT",
    value: "412,908.44",
    dot: "ok",
    note: "12 wallets · Blockradar TRON",
    live: false,
  },
  {
    id: "ngn-float",
    tone: "neutral",
    label: "NGN fiat float",
    value: "₦42,180,500",
    dot: "warn",
    note: "18% of target · low",
    live: false,
  },
  {
    id: "fx-position",
    tone: "neutral",
    label: "FX position",
    value: "+$8,240",
    dot: "ok",
    note: "Net long USDT vs NGN",
    live: false,
  },
  {
    id: "exposure-headroom",
    tone: "neutral",
    label: "Exposure headroom",
    value: "72%",
    dot: "ok",
    note: "Within inventory limit",
    live: false,
  },
]

/**
 * The payout / withdrawal approval queue (design markup line 11, `payouts`). Large
 * payouts (`big`) carry the amber Maker-checker tag and route Approve through
 * dual-control. Names + refs mirror the `seed()` operator/transaction dataset.
 */
const PAYOUTS: readonly TreasuryPayoutRow[] = [
  {
    id: "pay_7741",
    to: "Kelechi Chukwu · GTBank",
    ref: "wd_44219",
    method: "NGN payout · Flutterwave",
    amt: "₦4,820,000.00",
    big: true,
  },
  {
    id: "pay_7742",
    to: "Amara Okeke · TRON withdrawal",
    ref: "wd_44220",
    method: "USDT · Blockradar",
    amt: "1,250.00 USDT",
    big: false,
  },
  {
    id: "pay_7743",
    to: "Ngozi Eze · Access Bank",
    ref: "wd_44221",
    method: "NGN payout · Flutterwave",
    amt: "₦180,000.00",
    big: false,
  },
]

/**
 * The child-address sweeps list (design markup line 15, `sweeps`). Addresses are
 * TRON child wallets; the sweep threshold footer is a fixed 25 TRX (matching the
 * `sweep.threshold.trx` seed setting).
 */
const SWEEPS: readonly TreasurySweepRow[] = [
  {
    id: "sw_1",
    addr: "TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt",
    bal: "142.60 TRX",
    status: "Swept",
  },
  {
    id: "sw_2",
    addr: "TWk9Pn2rL5xQ8mV4bC7dH3fG1sA6eY0jZu",
    bal: "38.10 TRX",
    status: "Pending",
  },
  {
    id: "sw_3",
    addr: "TRb3Xc7v1kM9nP5wL2dQ8fH4gS6aE0yJ2t",
    bal: "12.40 TRX",
    status: "Below threshold",
  },
]

// design-faithful: the sweep threshold has no admin endpoint yet — it mirrors the
// `sweep.threshold.trx` seed setting (25 TRX).
const SWEEP_THRESHOLD = "25 TRX"

// Low-float alert is a representative flag matching the design's default-on banner
// (`hint-placeholder-val="{{ true }}"`).
const LOW_FLOAT = true

// A balance-card health dot's semantic → its token utility. Colour is never the sole
// signal — each dot is paired with a note that carries the same meaning.
const DOT_CLASS: Record<TreasuryCard["dot"], string> = {
  ok: "bg-tok",
  warn: "bg-twn",
  danger: "bg-tdn",
}

// A sweep status → its dot + label token utilities (matching the design's per-row
// `s.dot` / `s.fg`). Swept reads success, Pending warning, Below-threshold muted.
const SWEEP_STATUS: Record<
  TreasurySweepRow["status"],
  { dot: string; fg: string }
> = {
  Swept: { dot: "bg-tok", fg: "text-tok" },
  Pending: { dot: "bg-twn", fg: "text-twn" },
  "Below threshold": { dot: "bg-ink3", fg: "text-ink3" },
}

/** A single balance tile — the hero variant carries the dark-green gradient. */
function BalanceCard({ card }: { card: TreasuryCard }) {
  const hero = card.tone === "hero"
  return (
    <div
      style={hero ? { background: HERO_GRADIENT } : undefined}
      className={
        hero
          ? "rounded-2xl border border-transparent px-[18px] py-4 text-white"
          : "rounded-2xl border border-line bg-card px-[18px] py-4 text-ink"
      }
    >
      <div
        className={
          hero
            ? "text-[11.5px] font-semibold text-on-brand-muted"
            : "text-[11.5px] font-semibold text-ink3"
        }
      >
        {card.label}
      </div>
      <div className="mt-[5px] font-mono text-[21px] font-extrabold tracking-[-0.01em] tabular-nums">
        {card.value}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`size-[7px] shrink-0 rounded-full ${
            hero ? "bg-brand-amber" : DOT_CLASS[card.dot]
          }`}
        />
        <span
          className={
            hero ? "text-[11px] text-on-brand-muted" : "text-[11px] text-ink3"
          }
        >
          {card.note}
        </span>
      </div>
    </div>
  )
}

export function TreasuryPage() {
  // Local UI state for the flow-modal chain. `flow` tracks which step is open; the
  // active row drives the modal copy. No server call — approving simply advances
  // through the shared funds-safety modals then clears the row from the queue.
  const [flow, setFlow] = useState<null | "maker" | "stepup">(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [approved, setApproved] = useState<Record<string, boolean>>({})

  const active = PAYOUTS.find((p) => p.id === activeId) ?? null

  // Large payouts (design `p.big`) require maker-checker before step-up; smaller
  // ones go straight to step-up — matching the design's dual-control gate.
  function onApprove(row: TreasuryPayoutRow) {
    setActiveId(row.id)
    setFlow(row.big ? "maker" : "stepup")
  }

  function closeFlow() {
    setFlow(null)
    setActiveId(null)
  }

  function finishApprove() {
    if (activeId) setApproved((prev) => ({ ...prev, [activeId]: true }))
    closeFlow()
  }

  // The maker-checker change-preview diff for the active large payout.
  const makerDiff: MakerCheckerDiffRow[] = active
    ? [
        {
          field: `Payout ${active.ref}`,
          from: "Pending approval",
          to: "Approved · queued for engine",
        },
        { field: "Amount", from: "—", to: active.amt },
      ]
    : []

  return (
    <div className="mx-auto w-full max-w-[1300px] flex-1 overflow-y-auto p-[26px_30px_60px]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Treasury
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Custodial wallet balances, fiat float, FX position and the payout
          approval queue.
        </p>
      </div>

      {/* ── Low-float warning (optional) ────────────────────────────────────── */}
      {LOW_FLOAT && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-[#f0e2c4] bg-swn px-4 py-3"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="text-twn"
          >
            <path
              d="M12 4l9 16H3zM12 10v4M12 17h.01"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[12.5px] font-semibold text-twn">
            Low-float alert · NGN float is at 18% of target. Consider a treasury
            top-up before large payouts.
          </span>
        </div>
      )}

      {/* ── Balance cards (dark custodial hero) ─────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {TREASURY_CARDS.map((card) => (
          <BalanceCard key={card.id} card={card} />
        ))}
      </div>

      {/* ── Approval queue | Child-address sweeps (1.5fr / 1fr) ─────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Payout / withdrawal approval queue — maker-checker on large amounts */}
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[13px] font-extrabold text-ink">
              Payout / withdrawal approval queue
            </div>
            <span className="text-[11px] font-semibold text-ink3">
              Large payouts require maker-checker
            </span>
          </div>

          {PAYOUTS.map((row) => {
            const done = approved[row.id]
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 border-b border-line2 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-ink">
                    {row.to}
                  </div>
                  <div className="font-mono text-[11px] text-ink3">
                    {row.ref} · {row.method}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-[13.5px] font-extrabold text-ink tabular-nums">
                  {row.amt}
                </div>
                {row.big && (
                  <span className="shrink-0 rounded-md bg-swn px-2 py-[3px] text-[9.5px] font-extrabold tracking-[0.02em] text-twn uppercase">
                    Maker-checker
                  </span>
                )}
                {done ? (
                  <span className="shrink-0 rounded-[9px] bg-sok px-3.5 py-2 text-[12px] font-bold text-tok">
                    Approved
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onApprove(row)}
                    className={`shrink-0 rounded-[9px] px-3.5 py-2 text-[12px] font-bold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                      row.big
                        ? "bg-btn-dark text-white"
                        : "bg-brand-green text-white"
                    }`}
                  >
                    Approve
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Child-address sweeps — per-wallet balances + sweep threshold */}
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3.5 text-[13px] font-extrabold text-ink">
            Child-address sweeps
          </div>

          {SWEEPS.map((sweep) => {
            const tone = SWEEP_STATUS[sweep.status]
            return (
              <div
                key={sweep.id}
                className="flex items-center gap-2.5 border-b border-line2 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${tone.dot}`}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink2">
                  {sweep.addr}
                </span>
                <span className="shrink-0 font-mono text-[12px] font-bold text-ink tabular-nums">
                  {sweep.bal}
                </span>
                <span className={`shrink-0 text-[10.5px] font-bold ${tone.fg}`}>
                  {sweep.status}
                </span>
              </div>
            )
          })}

          {/* Sweep threshold footer */}
          <div className="mt-3.5 flex justify-between border-t border-line2 pt-3">
            <span className="text-[11.5px] text-ink3">Sweep threshold</span>
            <span className="font-mono text-[12px] font-bold text-ink tabular-nums">
              {SWEEP_THRESHOLD}
            </span>
          </div>
        </div>
      </div>

      {/* ── Funds-safety flow modals (design §5) ────────────────────────────── */}
      <MakerCheckerModal
        open={flow === "maker"}
        onOpenChange={(open) => (open ? undefined : closeFlow())}
        title={active ? `Approve payout ${active.ref}` : "Approve payout"}
        diff={makerDiff}
        onSubmit={() => setFlow("stepup")}
      />
      <StepUpModal
        open={flow === "stepup"}
        onOpenChange={(open) => (open ? undefined : closeFlow())}
        title={active ? `payout ${active.ref}` : "payout approval"}
        onComplete={finishApprove}
      />
    </div>
  )
}
