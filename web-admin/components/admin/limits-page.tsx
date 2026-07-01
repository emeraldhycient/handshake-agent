"use client"

/**
 * LimitsPage — DESIGN REPRODUCTION of the "Limits & velocity" screen (design
 * §6.26; markup docs/design-ref/screens/Limits.html). Pixel-faithful to the
 * design's own mock content — NOT wired to the real config API (real-data
 * reintegration is a separate, later step).
 *
 * Structure (from the markup): a page header, a row of tier tabs (`tierTabs`),
 * then a `1fr 1fr` grid of two cards — "Amount caps · {tier}" (key/value rows
 * each with an edit pencil) and "Velocity & counts · {tier}" (display-only
 * key/value rows). Switching the tier tab swaps the rows shown in both cards.
 *
 * Actions: per the subtitle ("Changes are maker-checker") each amount-cap edit
 * pencil opens the shared flow modals in the design's order — Reason (audit) →
 * Step-up (TOTP) → Maker-checker (from→to change preview, "Submit for approval").
 * The mock data mirrors the seed dataset shapes in docs/design-ref/logic.js
 * (per-tier NGN caps + tx-count/day) and the SPEC §6.26.
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import { ReasonModal } from "@/components/admin/flows/reason-modal"
import { StepUpModal } from "@/components/admin/flows/step-up-modal"
import { MakerCheckerModal } from "@/components/admin/flows/maker-checker-modal"
import type {
  LimitAmountRow,
  LimitTier,
  LimitTierId,
  LimitVelocityRow,
} from "@/types/components"

// The design's edit pencil (logic.js `editIcon`-shaped path); reused per amount row.
const EDIT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"

/**
 * Per-tier mock content — reproduces the seed dataset shapes in
 * docs/design-ref/logic.js (per-tier NGN amount caps + tx-count/day) and the
 * markup's four-row cards. Values are the design's own representative content,
 * not fetched.
 */
const TIERS: readonly LimitTier[] = [
  {
    id: "tier_1",
    label: "Tier 1",
    amountCaps: [
      { k: "Per-transaction max", v: "₦200,000" },
      { k: "Daily max · rolling 24h", v: "₦200,000" },
      { k: "Weekly max", v: "₦1,000,000" },
      { k: "Single on-chain send max", v: "50 USDT" },
    ],
    velocity: [
      { k: "Transactions / day", v: "10" },
      { k: "Sends / 10-min window", v: "3" },
      { k: "Cooling-off after tier change", v: "24h" },
      { k: "New-beneficiary hold", v: "12h" },
    ],
  },
  {
    id: "tier_2",
    label: "Tier 2",
    amountCaps: [
      { k: "Per-transaction max", v: "₦1,000,000" },
      { k: "Daily max · rolling 24h", v: "₦2,000,000" },
      { k: "Weekly max", v: "₦8,000,000" },
      { k: "Single on-chain send max", v: "500 USDT" },
    ],
    velocity: [
      { k: "Transactions / day", v: "50" },
      { k: "Sends / 10-min window", v: "6" },
      { k: "Cooling-off after tier change", v: "12h" },
      { k: "New-beneficiary hold", v: "6h" },
    ],
  },
  {
    id: "tier_3",
    label: "Tier 3",
    amountCaps: [
      { k: "Per-transaction max", v: "₦5,000,000" },
      { k: "Daily max · rolling 24h", v: "₦10,000,000" },
      { k: "Weekly max", v: "₦50,000,000" },
      { k: "Single on-chain send max", v: "5,000 USDT" },
    ],
    velocity: [
      { k: "Transactions / day", v: "200" },
      { k: "Sends / 10-min window", v: "10" },
      { k: "Cooling-off after tier change", v: "6h" },
      { k: "New-beneficiary hold", v: "1h" },
    ],
  },
] as const

/** One amount-cap key/value row with the design's edit pencil affordance. */
function AmountRow({
  row,
  onEdit,
}: {
  row: LimitAmountRow
  onEdit: (row: LimitAmountRow) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-[10px] last:border-b-0">
      <span className="text-[12.5px] text-ink2">{row.k}</span>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
          {row.v}
        </span>
        <button
          type="button"
          onClick={() => onEdit(row)}
          aria-label={`Edit ${row.k}`}
          className="flex size-[28px] items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d={EDIT_ICON}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}

/** One velocity/count key/value row (display-only per the markup). */
function VelocityRow({ row }: { row: LimitVelocityRow }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-[10px] last:border-b-0">
      <span className="text-[12.5px] text-ink2">{row.k}</span>
      <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
        {row.v}
      </span>
    </div>
  )
}

export function LimitsPage() {
  const [tierId, setTierId] = useState<LimitTierId>("tier_1")
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0]

  // The maker-checker flow chain (design order): reason → step-up → maker-checker.
  const [editing, setEditing] = useState<LimitAmountRow | null>(null)
  const [flow, setFlow] = useState<"reason" | "stepup" | "maker" | null>(null)

  function startEdit(row: LimitAmountRow) {
    setEditing(row)
    setFlow("reason")
  }

  function closeFlow() {
    setFlow(null)
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-[1080px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Limits &amp; velocity
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Per-tier caps, count caps, cooling-off and velocity windows. Changes
          are maker-checker.
        </p>
      </div>

      {/* ── Tier tabs ──────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="KYC tier" className="mb-4 flex gap-[9px]">
        {TIERS.map((t) => {
          const active = t.id === tierId
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTierId(t.id)}
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

      {/* ── Cards: Amount caps | Velocity & counts ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-[14px]">
        {/* Amount caps · {tier} */}
        <section className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
          <h2 className="mb-3 text-[13px] font-extrabold text-ink">
            Amount caps · {tier.label}
          </h2>
          {tier.amountCaps.map((row) => (
            <AmountRow key={row.k} row={row} onEdit={startEdit} />
          ))}
        </section>

        {/* Velocity & counts · {tier} */}
        <section className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
          <h2 className="mb-3 text-[13px] font-extrabold text-ink">
            Velocity &amp; counts · {tier.label}
          </h2>
          {tier.velocity.map((row) => (
            <VelocityRow key={row.k} row={row} />
          ))}
        </section>
      </div>

      {/* ── Maker-checker flow: reason → step-up → maker-checker ───────────── */}
      <ReasonModal
        open={flow === "reason"}
        onOpenChange={(open) => (open ? setFlow("reason") : closeFlow())}
        title={editing ? `Edit ${editing.k} · ${tier.label}` : "Edit limit"}
        onContinue={() => setFlow("stepup")}
      />
      <StepUpModal
        open={flow === "stepup"}
        onOpenChange={(open) => (open ? setFlow("stepup") : closeFlow())}
        title={editing ? `Edit ${editing.k} · ${tier.label}` : "Edit limit"}
        onComplete={() => setFlow("maker")}
      />
      <MakerCheckerModal
        open={flow === "maker"}
        onOpenChange={(open) => (open ? setFlow("maker") : closeFlow())}
        title="Update limit"
        diff={
          editing
            ? [
                {
                  field: `${editing.k} · ${tier.label}`,
                  from: editing.v,
                  to: editing.v,
                },
              ]
            : []
        }
        onSubmit={closeFlow}
      />
    </div>
  )
}
