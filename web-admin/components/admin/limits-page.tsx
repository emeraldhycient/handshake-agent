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
 * pencil opens the shared flow modals in the design's order — a new-value prompt
 * (captures the new cap), then Reason (audit) → Step-up (TOTP) → Maker-checker
 * (from→to change preview, "Submit for approval"). The mock data mirrors the seed
 * dataset shapes in docs/design-ref/logic.js (per-tier NGN caps + tx-count/day)
 * and the SPEC §6.26. Approving the maker-checker updates the edited row's value
 * in local state (the reactive mock), so the displayed cap changes.
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import { ReasonModal } from "@/components/admin/flows/reason-modal"
import { StepUpModal } from "@/components/admin/flows/step-up-modal"
import { MakerCheckerModal } from "@/components/admin/flows/maker-checker-modal"
import { pushToast } from "@/lib/store/toast-store"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
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
 * not fetched. This is the initial seed — the page lifts it into `useState` so
 * an approved amount-cap edit updates the edited row's displayed value.
 */
const TIER_SEED: readonly LimitTier[] = [
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

/**
 * Deep-copy a seed tier into mutable state shape so `setTiers` can replace an
 * amount-cap row's value without mutating the readonly seed.
 */
function cloneTier(tier: LimitTier): LimitTier {
  return {
    ...tier,
    amountCaps: tier.amountCaps.map((r) => ({ ...r })),
    velocity: tier.velocity.map((r) => ({ ...r })),
  }
}

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

/** The flow steps in the design's order — a new-value prompt precedes the audit chain. */
type LimitFlowStep = "value" | "reason" | "stepup" | "maker"

export function LimitsPage() {
  // The tiers are reactive: approving an edit updates the edited amount row's value.
  const [tiers, setTiers] = useState<LimitTier[]>(() =>
    TIER_SEED.map(cloneTier)
  )
  const [tierId, setTierId] = useState<LimitTierId>("tier_1")
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0]

  // The maker-checker flow chain (design order): value → reason → step-up → maker.
  const [editing, setEditing] = useState<LimitAmountRow | null>(null)
  const [newValue, setNewValue] = useState("")
  const [flow, setFlow] = useState<LimitFlowStep | null>(null)

  function startEdit(row: LimitAmountRow) {
    setEditing(row)
    setNewValue(row.v)
    setFlow("value")
  }

  function closeFlow() {
    setFlow(null)
    setEditing(null)
    setNewValue("")
  }

  // Approve the dual-control edit: write the captured value onto the edited row in
  // the active tier (the displayed cap changes), toast, then close the flow.
  function applyEdit() {
    if (!editing) return
    const next = newValue.trim()
    setTiers((prev) =>
      prev.map((t) =>
        t.id === tierId
          ? {
              ...t,
              amountCaps: t.amountCaps.map((r) =>
                r.k === editing.k ? { ...r, v: next } : r
              ),
            }
          : t
      )
    )
    pushToast(`${editing.k} · ${tier.label} → ${next}`, "ok")
    closeFlow()
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
        {tiers.map((t) => {
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

      {/* ── Edit flow: new value → reason → step-up → maker-checker ────────── */}
      <NewValueModal
        open={flow === "value"}
        onOpenChange={(open) => (open ? setFlow("value") : closeFlow())}
        title={editing ? `Edit ${editing.k} · ${tier.label}` : "Edit limit"}
        currentValue={editing?.v ?? ""}
        value={newValue}
        onValueChange={setNewValue}
        onContinue={() => setFlow("reason")}
      />
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
                  to: newValue.trim() || editing.v,
                },
              ]
            : []
        }
        onSubmit={applyEdit}
      />
    </div>
  )
}

/**
 * NewValueModal — the edit flow's first step. Captures the new cap value before the
 * audit chain (reason → step-up → maker-checker). Built on the shared Dialog primitive
 * (focus-trap + Esc close), styled like the other flow modals (radius-20 panel, tokens
 * only). Continue is refused while the field is empty; the change only enters the
 * dual-control chain once a value is present.
 */
function NewValueModal({
  open,
  onOpenChange,
  title,
  currentValue,
  value,
  onValueChange,
  onContinue,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  currentValue: string
  value: string
  onValueChange: (value: string) => void
  onContinue: () => void
}) {
  const canContinue = value.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[440px] max-w-[94vw] gap-0 p-6"
      >
        <div className="mb-1.5 flex items-center gap-[11px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sif text-tif">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d={EDIT_ICON}
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription className="mb-4 text-[13px] leading-normal text-ink2">
          Enter the new cap. The current value is{" "}
          <span className="font-mono font-bold text-ink tabular-nums">
            {currentValue}
          </span>
          .
        </DialogDescription>

        <label
          htmlFor="limit-new-value"
          className="mb-1.5 block text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase"
        >
          New value
        </label>
        <input
          id="limit-new-value"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={currentValue}
          aria-label="New value"
          className="w-full rounded-xl border border-line bg-field px-3.5 py-3 font-mono text-[14px] font-bold text-ink tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        <div className="mt-[18px] flex gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-xl border border-line px-3 py-3 text-center text-sm font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canContinue && onContinue()}
            disabled={!canContinue}
            className={cn(
              "flex-1 rounded-xl px-3 py-3 text-center text-sm font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              canContinue
                ? "bg-btn-dark text-white"
                : "cursor-not-allowed bg-line text-ink3"
            )}
          >
            Continue
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
