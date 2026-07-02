"use client"

/**
 * LimitsPage — the "Limits & velocity" screen (design §6.26; markup
 * docs/design-ref/screens/Limits.html).
 *
 * Structure (from the markup): a page header, a row of tier tabs, then a `1fr 1fr`
 * grid of two cards — "Amount caps · {tier}" (key/value rows each with an edit
 * pencil) and "Velocity & counts · {tier}" (display-only key/value rows). Switching
 * the tier tab swaps the rows shown in both cards.
 *
 * WIRED (Phase 6a): the per-tier caps are REAL, resolved from the
 * `limits.NGN.{tier}.perTxFiatMax` / `.dailyFiatMax` / `.dailyTxCountMax` registry
 * keys via GET /admin/settings (`useSettings("KYC")`). The design ALSO shows rows the
 * registry has no key for — "Weekly max", "Single on-chain send max", "Sends / 10-min
 * window", "Cooling-off after tier change", "New-beneficiary hold" — those render a
 * subtle "—" (no backing key) and are recorded as shapeGaps for later backend
 * enrichment. Four async branches: loading / error / empty / data.
 *
 * Editing an amount cap is maker-checker: the pencil opens a new-value prompt →
 * reason (audit) → step-up (TOTP) → maker-checker. The edit SUBMIT is a Phase-7
 * write (it updates local state only for now — the real PATCH + re-read lands later).
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ReasonModal } from "@/components/admin/flows/reason-modal"
import { StepUpModal } from "@/components/admin/flows/step-up-modal"
import { MakerCheckerModal } from "@/components/admin/flows/maker-checker-modal"
import { pushToast } from "@/lib/store/toast-store"
import { useSettings } from "@/lib/query/hooks"
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

// Placeholder for a design row the registry has no backing key for (shapeGap).
const NO_KEY = "—"

/** The three NGN KYC tiers the registry enumerates (`limits.NGN.<tier>.*`). */
const TIER_META: readonly { id: LimitTierId; label: string }[] = [
  { id: "tier_1", label: "Tier 1" },
  { id: "tier_2", label: "Tier 2" },
  { id: "tier_3", label: "Tier 3" },
]

/** Format an NGN integer cap as the design's mono string, else the no-key dash. */
function ngn(value: unknown): string {
  return typeof value === "number" ? `₦${value.toLocaleString()}` : NO_KEY
}

/** Format a plain count cap (tx/day), else the no-key dash. */
function count(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString() : NO_KEY
}

/**
 * Build the per-tier cards from the real KYC-category settings. Amount caps map the
 * three registry keys; the extra design rows (Weekly / Single on-chain send) have no
 * key and render "—". Velocity maps the one backed count (Transactions / day); the
 * rest (10-min window / cooling-off / new-beneficiary hold) render "—" (shapeGaps).
 */
function buildTiers(settings: readonly EffectiveSetting[]): LimitTier[] {
  const byKey = new Map(settings.map((s) => [s.key, s.value]))
  return TIER_META.map(({ id, label }) => {
    const base = `limits.NGN.${id}`
    const amountCaps: LimitAmountRow[] = [
      { k: "Per-transaction max", v: ngn(byKey.get(`${base}.perTxFiatMax`)) },
      {
        k: "Daily max · rolling 24h",
        v: ngn(byKey.get(`${base}.dailyFiatMax`)),
      },
      { k: "Weekly max", v: NO_KEY },
      { k: "Single on-chain send max", v: NO_KEY },
    ]
    const velocity: LimitVelocityRow[] = [
      {
        k: "Transactions / day",
        v: count(byKey.get(`${base}.dailyTxCountMax`)),
      },
      { k: "Sends / 10-min window", v: NO_KEY },
      { k: "Cooling-off after tier change", v: NO_KEY },
      { k: "New-beneficiary hold", v: NO_KEY },
    ]
    return { id, label, amountCaps, velocity }
  })
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
  const query = useSettings("KYC")

  // Base tiers derived from the real settings. Local edits overlay on top so an
  // approved maker-checker edit updates the displayed cap (Phase-7 write is local-only).
  const baseTiers = useMemo(() => buildTiers(query.data ?? []), [query.data])
  // Overlay of applied edits, keyed `tierId::capLabel` → new value string.
  const [edits, setEdits] = useState<Record<string, string>>({})

  const tiers = useMemo<LimitTier[]>(
    () =>
      baseTiers.map((t) => ({
        ...t,
        amountCaps: t.amountCaps.map((r) => {
          const override = edits[`${t.id}::${r.k}`]
          return override !== undefined ? { ...r, v: override } : r
        }),
      })),
    [baseTiers, edits]
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

  // Approve the dual-control edit: overlay the captured value on the edited row in
  // the active tier (the displayed cap changes), toast, then close the flow.
  function applyEdit() {
    if (!editing || !tier) return
    const next = newValue.trim()
    setEdits((prev) => ({ ...prev, [`${tier.id}::${editing.k}`]: next }))
    pushToast(`${editing.k} · ${tier.label} → ${next}`, "ok")
    closeFlow()
  }

  const flowTitle =
    editing && tier ? `Edit ${editing.k} · ${tier.label}` : "Edit limit"

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

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {query.isLoading && (
        <div aria-busy="true">
          <div className="mb-4 flex gap-[9px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[38px] w-[84px] rounded-[10px]" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-[14px]">
            <Skeleton className="h-64 rounded-[16px]" />
            <Skeleton className="h-64 rounded-[16px]" />
          </div>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {query.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
          <p className="text-sm font-bold text-tdn">Failed to load limits</p>
          <p className="mt-1 text-[12.5px] text-ink2">
            The tier-limit config could not be read.
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

      {/* ── Data (tier tabs + cards) ───────────────────────────────────────── */}
      {query.isSuccess && tier && (
        <>
          {/* Tier tabs */}
          <div
            role="tablist"
            aria-label="KYC tier"
            className="mb-4 flex gap-[9px]"
          >
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

          {/* Cards: Amount caps | Velocity & counts */}
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
        </>
      )}

      {/* ── Edit flow: new value → reason → step-up → maker-checker ────────── */}
      <NewValueModal
        open={flow === "value"}
        onOpenChange={(open) => (open ? setFlow("value") : closeFlow())}
        title={flowTitle}
        currentValue={editing?.v ?? ""}
        value={newValue}
        onValueChange={setNewValue}
        onContinue={() => setFlow("reason")}
      />
      <ReasonModal
        open={flow === "reason"}
        onOpenChange={(open) => (open ? setFlow("reason") : closeFlow())}
        title={flowTitle}
        onContinue={() => setFlow("stepup")}
      />
      <StepUpModal
        open={flow === "stepup"}
        onOpenChange={(open) => (open ? setFlow("stepup") : closeFlow())}
        title={flowTitle}
        onComplete={() => setFlow("maker")}
      />
      <MakerCheckerModal
        open={flow === "maker"}
        onOpenChange={(open) => (open ? setFlow("maker") : closeFlow())}
        title="Update limit"
        diff={
          editing && tier
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
