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
 * reason (audit) → step-up (TOTP) → maker-checker. WIRED (Phase 9 — WRITE): the
 * maker-checker submit fires the real step-up-guarded PATCH /admin/settings/:key
 * (`useSetSetting`) for the edited cap's `limits.NGN.<tier>.<field>` key, carrying the
 * setting's own scope. The server re-validates + hot-reloads + audits `config_change`;
 * the settings query then invalidates so the cap re-resolves. A 403
 * ADMIN_STEP_UP_REQUIRED opens the StepUpDialog and the PATCH replays after re-auth
 * (`useStepUpRetry`). Only caps with a backing registry key are editable — the
 * design rows the registry has no key for (Weekly max, Single on-chain send max) render
 * "—" and expose no edit affordance. Nothing moves money (§3.1).
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ReasonModal } from "@/components/admin/flows/reason-modal"
import { StepUpModal } from "@/components/admin/flows/step-up-modal"
import { MakerCheckerModal } from "@/components/admin/flows/maker-checker-modal"
import { SettingValueModal } from "@/components/admin/flows/setting-value-modal"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"
import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
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

/**
 * The editable amount caps' registry leaves, in display order. Each maps the design's
 * amount-cap label to the `limits.NGN.<tier>.<field>` key suffix so an edit targets the
 * same leaf the read resolved. Rows not listed here (Weekly max, Single on-chain send
 * max) have no backing key and are display-only.
 */
const EDITABLE_CAPS: readonly { label: string; field: string }[] = [
  { label: "Per-transaction max", field: "perTxFiatMax" },
  { label: "Daily max · rolling 24h", field: "dailyFiatMax" },
]

/**
 * The setting leaf backing an editable cap — its full key + scope, carried so the write
 * targets the same leaf the read resolved. Keyed `${tierId}::${label}` in a lookup map.
 */
interface CapSetting {
  settingKey: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

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

/**
 * Build the `${tierId}::${label}` → backing-setting lookup for the editable caps. Only
 * caps whose `limits.NGN.<tier>.<field>` key is present in the settings response get an
 * entry — so an edit affordance appears only where a real PATCH can land.
 */
function buildCapSettings(
  settings: readonly EffectiveSetting[]
): Map<string, CapSetting> {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  const map = new Map<string, CapSetting>()
  for (const { id } of TIER_META) {
    const base = `limits.NGN.${id}`
    for (const { label, field } of EDITABLE_CAPS) {
      const key = `${base}.${field}`
      const setting = byKey.get(key)
      if (!setting || typeof setting.value !== "number") continue
      map.set(`${id}::${label}`, {
        settingKey: key,
        scope: setting.scope,
        scopeValue: setting.scopeValue,
      })
    }
  }
  return map
}

/**
 * One amount-cap key/value row. The design's edit pencil is shown ONLY for caps with a
 * backing registry key (`editable`) — display-only design rows (no key, value "—") never
 * expose an edit affordance, so an un-persistable edit is impossible.
 */
function AmountRow({
  row,
  editable,
  onEdit,
}: {
  row: LimitAmountRow
  editable: boolean
  onEdit: (row: LimitAmountRow) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-[10px] last:border-b-0">
      <span className="text-[12.5px] text-ink2">{row.k}</span>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
          {row.v}
        </span>
        {editable && (
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
        )}
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

/** Normalizes a mutation/step-up failure into a user-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

/** Parse a cap input (plain integer NGN) → a finite non-negative integer, else null. */
function parseCap(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function LimitsPage() {
  const query = useSettings("KYC")

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  // Tiers + the editable-cap → backing-setting lookup, both derived from the real
  // settings. The displayed caps re-resolve from the invalidated query after a write.
  const tiers = useMemo<LimitTier[]>(
    () => buildTiers(query.data ?? []),
    [query.data]
  )
  const capSettings = useMemo(
    () => buildCapSettings(query.data ?? []),
    [query.data]
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

  const parsed = parseCap(newValue)

  /**
   * Approve the dual-control edit. Persists the new cap via the real step-up-guarded
   * PATCH /admin/settings/:key (`useSetSetting`) against the edited cap's backing key,
   * carrying the setting's own scope. The server re-validates + hot-reloads + audits; the
   * settings query then invalidates so the cap re-resolves. A 403 ADMIN_STEP_UP_REQUIRED
   * opens the StepUpDialog and the PATCH replays after re-auth. Nothing moves money (§3.1).
   */
  function applyEdit() {
    if (!editing || !tier || parsed === null) return
    const backing = capSettings.get(`${tier.id}::${editing.k}`)
    if (!backing) return
    const label = editing.k
    const tierLabel = tier.label
    const value = parsed
    closeFlow()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key: backing.settingKey,
              input: {
                value,
                scope: backing.scope,
                scopeValue: backing.scopeValue,
              },
            })
            .then(() => undefined)
        )
        if (ok)
          pushToast(
            `${label} · ${tierLabel} → ₦${value.toLocaleString()}`,
            "ok"
          )
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
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
                <AmountRow
                  key={row.k}
                  row={row}
                  editable={capSettings.has(`${tier.id}::${row.k}`)}
                  onEdit={startEdit}
                />
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
      <SettingValueModal
        open={flow === "value"}
        onOpenChange={(open) => (open ? setFlow("value") : closeFlow())}
        title={flowTitle}
        fieldLabel="New value"
        currentValue={editing?.v ?? ""}
        value={newValue}
        onValueChange={setNewValue}
        canContinue={parsed !== null}
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
          editing && tier && parsed !== null
            ? [
                {
                  field: `${editing.k} · ${tier.label}`,
                  from: editing.v,
                  to: `₦${parsed.toLocaleString()}`,
                },
              ]
            : []
        }
        onSubmit={applyEdit}
      />

      {/* Server-side step-up re-auth: a 403 on the cap PATCH opens this; the PATCH
          replays after re-authentication (settings then invalidate). */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then(() => undefined)
            .catch((error) => pushToast(errorMessage(error), "warn"))
        }}
      />
    </div>
  )
}
