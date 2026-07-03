"use client"

/**
 * LimitsPage — the "Limits & velocity" screen (design §6.26; markup
 * docs/design-ref/screens/Limits.html).
 *
 * Structure: a page header, tier tabs, then a `1fr 1fr` grid of two cards — "Amount
 * caps · {tier}" and "Velocity & counts · {tier}". Switching the tier tab swaps the
 * rows shown in both cards.
 *
 * WIRED to the real registry via GET /admin/settings (all categories, so both the
 * `limits.NGN.<tier>.*` tier caps AND the global `beneficiary.cryptoCoolingOffSeconds`
 * resolve). A row is EDITABLE only when its config key exists AND is enforced
 * server-side — currently the per-tier `perTxFiatMax` / `dailyFiatMax` /
 * `weeklyFiatMax` (rolling 7-day) / `perSendOnChainFiatMax` (single on-chain send) /
 * `sendsPer10MinMax` (rolling 10-minute send count) / `dailyTxCountMax`, the
 * tier-change cooling-off, and the new-beneficiary cooling-off — every row is now
 * backed by real server-side enforcement. A row still renders "—" with NO edit
 * affordance ONLY if its config key is absent from the read (defence: never expose an
 * editor for a cap that isn't resolvable/enforced — root §3.6).
 *
 * Editing is maker-checker: the pencil opens a new-value prompt → reason (audit) →
 * step-up (TOTP) → maker-checker, then fires the real step-up-guarded PATCH
 * /admin/settings/:key (`useSetSetting`) for the row's backing leaf. A 403
 * ADMIN_STEP_UP_REQUIRED opens the StepUpDialog and the PATCH replays after re-auth. The
 * server re-validates + hot-reloads + audits; the settings query then invalidates so the
 * row re-resolves. Nothing moves money (§3.1). Four async branches: loading/error/empty/data.
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import { Skeleton } from "@/components/ui/skeleton"
import { NativeSelect } from "@/components/ui/native-select"
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
  LimitEditLeaf,
  LimitLeafKind,
  LimitTier,
  LimitTierId,
  LimitVelocityRow,
} from "@/types/components"

// The design's edit pencil (logic.js `editIcon`-shaped path); reused per editable row.
const EDIT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"

// Placeholder for a row whose cap the engine does not yet enforce (no editor — §3.6).
const NO_KEY = "—"

/** The three NGN KYC tiers the registry enumerates (`limits.NGN.<tier>.*`). */
const TIER_META: readonly { id: LimitTierId; label: string }[] = [
  { id: "tier_1", label: "Tier 1" },
  { id: "tier_2", label: "Tier 2" },
  { id: "tier_3", label: "Tier 3" },
]

/** Humanize a seconds duration for display (e.g. 86400 → "24h", 0 → "None"). */
function humanizeSeconds(s: number): string {
  if (s === 0) return "None"
  if (s % 86400 === 0) return `${s / 86400}d`
  if (s % 3600 === 0) return `${s / 3600}h`
  if (s % 60 === 0) return `${s / 60}m`
  return `${s}s`
}

/** A fiat amount shown in `currency`. Naira keeps its familiar symbol; the rest use the
 * ISO code suffix so every currency is unambiguous. */
function formatAmount(currency: string, n: number): string {
  return currency === "NGN"
    ? `₦${n.toLocaleString()}`
    : `${n.toLocaleString()} ${currency}`
}

/** Format a numeric leaf value by its kind (fiat amount / plain count / duration). */
function formatLeaf(kind: LimitLeafKind, n: number, currency: string): string {
  if (kind === "amount") return formatAmount(currency, n)
  if (kind === "count") return n.toLocaleString()
  return humanizeSeconds(n)
}

/** The edit field's label + a11y name for a leaf kind (units are explicit). */
function fieldLabelFor(kind: LimitLeafKind, currency: string): string {
  if (kind === "amount") return `New value (${currency})`
  if (kind === "count") return "New value (count)"
  return "New value (seconds)"
}

/**
 * Build a key/value row. A row is EDITABLE whenever its config key is PRESENT in the
 * read (registered + enforced-when-present) — even if the value is unset (shown as "Not
 * set"), so an operator can configure a currency's limits from scratch. A key ABSENT
 * from the read (not registered) renders "—" with no editor (§3.6 guard).
 */
function leafRow(
  label: string,
  setting: EffectiveSetting | undefined,
  kind: LimitLeafKind,
  currency: string
): LimitAmountRow {
  if (setting === undefined) return { k: label, v: NO_KEY }
  const value = setting.value
  return {
    k: label,
    v: typeof value === "number" ? formatLeaf(kind, value, currency) : "Not set",
    edit: {
      key: setting.key,
      scope: setting.scope,
      scopeValue: setting.scopeValue,
      kind,
    },
  }
}

/**
 * Build the per-tier cards for `currency` from the real settings. Amount caps map the
 * per-currency, per-tier keys (`limits.<currency>.<tier>.*`); every one is registered +
 * enforced-when-present, so an unset cap shows "Not set" with an editor. The two
 * cooling-offs are GLOBAL leaves (tier/currency-independent), shown on every card.
 */
function buildTiers(
  settings: readonly EffectiveSetting[],
  currency: string
): LimitTier[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  const benefHold = byKey.get("beneficiary.cryptoCoolingOffSeconds")
  const tierChangeHold = byKey.get("compliance.tierChangeCoolingOffSeconds")
  return TIER_META.map(({ id, label }) => {
    const base = `limits.${currency}.${id}`
    const amountCaps: LimitAmountRow[] = [
      leafRow("Per-transaction max", byKey.get(`${base}.perTxFiatMax`), "amount", currency),
      leafRow("Daily max · rolling 24h", byKey.get(`${base}.dailyFiatMax`), "amount", currency),
      leafRow("Weekly max · rolling 7d", byKey.get(`${base}.weeklyFiatMax`), "amount", currency),
      leafRow(
        "Single on-chain send max",
        byKey.get(`${base}.perSendOnChainFiatMax`),
        "amount",
        currency
      ),
    ]
    const velocity: LimitVelocityRow[] = [
      leafRow("Transactions / day", byKey.get(`${base}.dailyTxCountMax`), "count", currency),
      leafRow(
        "Sends / 10-min window",
        byKey.get(`${base}.sendsPer10MinMax`),
        "count",
        currency
      ),
      leafRow("Cooling-off after tier change", tierChangeHold, "seconds", currency),
      leafRow("New-beneficiary hold", benefHold, "seconds", currency),
    ]
    return { id, label, amountCaps, velocity }
  })
}

/** Distinct fiat codes that have registered `limits.<code>.*` keys in the read. */
function availableCurrencies(settings: readonly EffectiveSetting[]): string[] {
  const codes = new Set<string>()
  for (const s of settings) {
    const m = /^limits\.([A-Z]{3})\./.exec(s.key)
    if (m) codes.add(m[1])
  }
  // NGN first (the primary currency), then the rest alphabetically.
  return [...codes].sort((a, b) =>
    a === "NGN" ? -1 : b === "NGN" ? 1 : a.localeCompare(b)
  )
}

/**
 * One key/value row. The edit pencil shows ONLY when the row is backed by an enforced,
 * editable leaf (`row.edit`) — a "—" placeholder for an unenforced cap never exposes an
 * editor, so an un-persistable (or fake) edit is impossible.
 */
function LimitLeafRow({
  row,
  onEdit,
}: {
  row: LimitAmountRow | LimitVelocityRow
  onEdit: (row: LimitAmountRow | LimitVelocityRow) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-[10px] last:border-b-0">
      <span className="text-[12.5px] text-ink2">{row.k}</span>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
          {row.v}
        </span>
        {row.edit && (
          <button
            type="button"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.k}`}
            className="flex size-[28px] items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
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

/** The flow steps in the design's order — a new-value prompt precedes the audit chain. */
type LimitFlowStep = "value" | "reason" | "stepup" | "maker"

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

/** Parse a limit input (plain non-negative integer) → a number, else null. */
function parseCap(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 0 ? n : null
}

type EditableRow = LimitAmountRow | LimitVelocityRow

export function LimitsPage() {
  // All categories: the tier caps live under "KYC", the new-beneficiary hold under
  // "Beneficiary" — one read resolves both.
  const query = useSettings()

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  const settings = useMemo(() => query.data ?? [], [query.data])
  const currencies = useMemo(() => availableCurrencies(settings), [settings])
  const settingsByKey = useMemo(
    () => new Map(settings.map((s) => [s.key, s])),
    [settings]
  )

  // The currency whose per-tier limits are shown (default NGN — the primary currency).
  const [currency, setCurrency] = useState("NGN")
  const activeCurrency = currencies.includes(currency)
    ? currency
    : (currencies[0] ?? "NGN")
  const tiers = useMemo<LimitTier[]>(
    () => buildTiers(settings, activeCurrency),
    [settings, activeCurrency]
  )

  const [tierId, setTierId] = useState<LimitTierId>("tier_1")
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0]

  // The maker-checker flow chain (design order): value → reason → step-up → maker.
  const [editing, setEditing] = useState<EditableRow | null>(null)
  const [newValue, setNewValue] = useState("")
  const [flow, setFlow] = useState<LimitFlowStep | null>(null)

  function startEdit(row: EditableRow) {
    if (!row.edit) return
    const raw = settingsByKey.get(row.edit.key)?.value
    setEditing(row)
    setNewValue(typeof raw === "number" ? String(raw) : "")
    setFlow("value")
  }

  function closeFlow() {
    setFlow(null)
    setEditing(null)
    setNewValue("")
  }

  const parsed = parseCap(newValue)
  const leaf: LimitEditLeaf | undefined = editing?.edit

  // A per-currency leaf (`limits.<code>.<tier>.*`) is labelled with the currency + tier;
  // a global leaf (e.g. the new-beneficiary hold) carries neither, so no misleading suffix.
  const tierSuffix = (l: LimitEditLeaf | undefined): string =>
    l && l.key.startsWith("limits.") && tier
      ? ` · ${activeCurrency} ${tier.label}`
      : ""

  /**
   * Approve the dual-control edit. Persists the new value via the real step-up-guarded
   * PATCH /admin/settings/:key against the row's backing leaf, carrying its scope. The
   * server re-validates + hot-reloads + audits; the settings query then invalidates so the
   * row re-resolves. A 403 opens the StepUpDialog and the PATCH replays after re-auth.
   * Nothing moves money (§3.1).
   */
  function applyEdit() {
    if (!editing || !leaf || parsed === null) return
    const label = `${editing.k}${tierSuffix(leaf)}`
    const kind = leaf.kind
    const value = parsed
    const key = leaf.key
    const scope = leaf.scope
    const scopeValue = leaf.scopeValue
    closeFlow()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({ key, input: { value, scope, scopeValue } })
            .then(() => undefined)
        )
        if (ok)
          pushToast(`${label} → ${formatLeaf(kind, value, activeCurrency)}`, "ok")
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
  }

  const flowTitle = editing ? `Edit ${editing.k}${tierSuffix(leaf)}` : "Edit limit"

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

      {/* ── Data (currency selector + tier tabs + cards) ───────────────────── */}
      {query.isSuccess && tier && (
        <>
          {/* Currency selector + tier tabs */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="KYC tier" className="flex gap-[9px]">
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

            <label className="flex items-center gap-2 text-[12px] font-bold text-ink2">
              Currency
              <NativeSelect
                aria-label="Limits currency"
                value={activeCurrency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-[36px] w-[110px]"
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>

          {/* Cards: Amount caps | Velocity & counts */}
          <div className="grid grid-cols-2 gap-[14px]">
            <section className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
              <h2 className="mb-3 text-[13px] font-extrabold text-ink">
                Amount caps · {activeCurrency} {tier.label}
              </h2>
              {tier.amountCaps.map((row) => (
                <LimitLeafRow key={row.k} row={row} onEdit={startEdit} />
              ))}
            </section>

            <section className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
              <h2 className="mb-3 text-[13px] font-extrabold text-ink">
                Velocity &amp; counts · {activeCurrency} {tier.label}
              </h2>
              {tier.velocity.map((row) => (
                <LimitLeafRow key={row.k} row={row} onEdit={startEdit} />
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
        fieldLabel={leaf ? fieldLabelFor(leaf.kind, activeCurrency) : "New value"}
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
          editing && leaf && parsed !== null
            ? [
                {
                  field: `${editing.k}${tierSuffix(leaf)}`,
                  from: editing.v,
                  to: formatLeaf(leaf.kind, parsed, activeCurrency),
                },
              ]
            : []
        }
        onSubmit={applyEdit}
      />

      {/* Server-side step-up re-auth: a 403 on the PATCH opens this; it replays after
          re-authentication (settings then invalidate). */}
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
