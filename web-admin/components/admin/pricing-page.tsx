"use client"

/**
 * PricingPage — per capability × asset × currency pricing (design §6.22 /
 * docs/design-ref/screens/Pricing.html).
 *
 * WIRED to the real `pricing.*` registry keys via GET /admin/settings
 * (`useSettings("Pricing")`). Three editable families, all funds-safety-gated
 * (value → reason → step-up → maker-checker → PATCH /admin/settings/:key), all
 * DERIVING the user-facing rate/margin (never storing a line item, root §3.1):
 *
 *   1. SPREADS — each priced asset (USDT/BTC/TRX) contributes a Buy + Sell row
 *      (`…buySpreadBps` / `…sellSpreadBps`); the NGN base rate drives the preview.
 *   2. PROCESSING FEE — the global `pricing.processingFeeBps`, editable from the header.
 *   3. BASE RATES — one per (asset × currency) `…baseRates.<code>`. This is the
 *      "add more prices" surface: a currency is fail-closed on enablement until at
 *      least one base rate keyed by its code exists (root §7), so an operator prices
 *      a newly-added currency here (edit an existing rate, or "Add price" a new pair).
 *
 * The generalized edit flow patches ANY numeric pricing leaf through the same audit
 * chain; a 403 ADMIN_STEP_UP_REQUIRED opens the StepUpDialog and replays after
 * re-auth (`useStepUpRetry`). The server re-validates + hot-reloads + audits; the
 * settings query then invalidates so the rows re-derive. Nothing moves money (§3.1).
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import { AddPriceDialog } from "@/components/admin/add-price-dialog"
import { PricingBaseRates } from "@/components/admin/pricing-base-rates"
import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { SettingValueModal } from "@/components/admin/flows/setting-value-modal"
import { Skeleton } from "@/components/ui/skeleton"
import { NativeSelect } from "@/components/ui/native-select"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"
import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { cn } from "@/lib/utils"
import type {
  AddPriceOption,
  PricingBaseRateRow,
} from "@/types/components"

// The design's exact 7-column spread-grid template (Pricing.html).
const PRICING_GRID = "grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1fr_1.4fr_0.7fr]"
const PRICED_ASSETS = ["USDT", "BTC", "TRX"] as const
const NO_MINMAX = "—"
const BASE_RATE_RE = /^pricing\.assets\.([A-Za-z0-9]+)\.baseRates\.([A-Z]{3})$/

/** One resolved spread row (buy or sell) of the design's pricing grid. */
interface SpreadRow {
  id: string
  cap: string
  pair: string
  spread: string
  fee: string
  minmax: string
  userRate: string
  margin: string
  spreadKey: string
  spreadBps: number | null
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

/**
 * A single numeric-pricing edit in flight — the generalized target the audit chain
 * patches. `format` renders the value for the diff/toast; `integer` restricts the
 * captured value (bps are whole; a base rate may be a decimal).
 */
interface EditTarget {
  key: string
  title: string
  fieldLabel: string
  currentLabel: string
  seed: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
  diffField: string
  toastLabel: string
  format: (n: number) => string
  integer: boolean
}

function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}
function num(setting: EffectiveSetting | undefined): number | null {
  return setting && typeof setting.value === "number" ? setting.value : null
}
/** A fiat rate shown in `currency` — ₦ for Naira, ISO-code suffix otherwise. */
function fiatRate(currency: string, rate: number): string {
  const n = rate.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency === "NGN" ? `₦${n}` : `${n} ${currency}`
}
function formatRate(code: string, n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${code}`
}
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

/** Parse the captured value: a finite non-negative number (whole when `integer`). */
function parseValue(input: string, integer: boolean): number | null {
  const t = input.trim()
  if (t === "") return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  if (integer && !Number.isInteger(n)) return null
  return n
}

/**
 * Pivot the flat pricing settings into per-asset Buy + Sell spread rows, with the
 * effective-rate preview shown in `currency` (its base rate drives the preview; the
 * spread itself is per-asset and currency-agnostic). A currency with no base rate for an
 * asset previews "—".
 */
function buildSpreadRows(
  settings: readonly EffectiveSetting[],
  currency: string
): SpreadRow[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  const feeBps = num(byKey.get("pricing.processingFeeBps"))
  const feeLabel = feeBps === null ? "—" : bpsToPct(feeBps)

  const rows: SpreadRow[] = []
  for (const asset of PRICED_ASSETS) {
    const base = `pricing.assets.${asset}`
    const baseRate = num(byKey.get(`${base}.baseRates.${currency}`))
    const buySetting = byKey.get(`${base}.buySpreadBps`)
    const sellSetting = byKey.get(`${base}.sellSpreadBps`)
    const buyBps = num(buySetting)
    const sellBps = num(sellSetting)
    if (baseRate === null && buyBps === null && sellBps === null) continue

    const derive = (spreadBps: number | null, dir: "buy" | "sell") => {
      if (baseRate === null || spreadBps === null) return "—"
      const factor =
        dir === "buy" ? 1 + spreadBps / 10_000 : 1 - spreadBps / 10_000
      return fiatRate(currency, baseRate * factor)
    }
    const margin = (spreadBps: number | null) => {
      const spreadPct = spreadBps === null ? 0 : spreadBps / 100
      const feePct = feeBps === null ? 0 : feeBps / 100
      return `${(spreadPct + feePct).toFixed(2)}%`
    }
    const mk = (dir: "buy" | "sell", bpsVal: number | null, setting?: EffectiveSetting): SpreadRow => ({
      id: `${asset}-${dir}`,
      cap: `crypto.${dir}`,
      pair: `${asset} / ${currency}`,
      spread: bpsVal === null ? "—" : bpsToPct(bpsVal),
      fee: feeLabel,
      minmax: NO_MINMAX,
      userRate: derive(bpsVal, dir),
      margin: margin(bpsVal),
      spreadKey: `${base}.${dir}SpreadBps`,
      spreadBps: bpsVal,
      scope: setting?.scope ?? "global",
      scopeValue: setting?.scopeValue ?? null,
    })
    rows.push(mk("buy", buyBps, buySetting), mk("sell", sellBps, sellSetting))
  }
  return rows
}

/** Distinct fiat codes that have any base rate registered in the read (NGN first). */
function pricingCurrencies(settings: readonly EffectiveSetting[]): string[] {
  const codes = new Set<string>()
  for (const s of settings) {
    const m = /^pricing\.assets\.[A-Za-z0-9]+\.baseRates\.([A-Z]{3})$/.exec(s.key)
    if (m) codes.add(m[1])
  }
  if (codes.size === 0) codes.add("NGN")
  return [...codes].sort((a, b) =>
    a === "NGN" ? -1 : b === "NGN" ? 1 : a.localeCompare(b)
  )
}

/** Split base-rate settings into configured rows (value present) and unpriced options. */
function buildBaseRates(settings: readonly EffectiveSetting[]): {
  rows: PricingBaseRateRow[]
  options: AddPriceOption[]
} {
  const rows: PricingBaseRateRow[] = []
  const options: AddPriceOption[] = []
  for (const st of settings) {
    const m = BASE_RATE_RE.exec(st.key)
    if (!m) continue
    const [, asset, code] = m
    if (typeof st.value === "number") {
      rows.push({
        id: `${asset}-${code}`,
        asset,
        code,
        key: st.key,
        value: st.value,
        label: formatRate(code, st.value),
        scope: st.scope,
        scopeValue: st.scopeValue,
      })
    } else {
      options.push({ asset, code })
    }
  }
  const byAssetThenCode = (a: { asset: string; code: string }, b: { asset: string; code: string }) =>
    a.asset.localeCompare(b.asset) || a.code.localeCompare(b.code)
  rows.sort(byAssetThenCode)
  options.sort(byAssetThenCode)
  return { rows, options }
}

/** One body row of the spread grid — including the inline Edit pill. */
function SpreadTableRow({
  row,
  onEdit,
}: {
  row: SpreadRow
  onEdit: (row: SpreadRow) => void
}) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        PRICING_GRID
      )}
    >
      <div className="font-mono text-[12px] font-bold text-ink">{row.cap}</div>
      <div className="font-mono text-[11.5px] text-ink2">{row.pair}</div>
      <div className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
        {row.spread}
      </div>
      <div className="font-mono text-[11.5px] text-ink2 tabular-nums">{row.fee}</div>
      <div className="font-mono text-[11px] text-ink2 tabular-nums">{row.minmax}</div>
      <div className="text-[11px]">
        <div className="text-ink">
          User sees{" "}
          <span className="font-mono font-bold tabular-nums">{row.userRate}</span>
        </div>
        <div className="text-twn">
          margin{" "}
          <span className="font-mono font-bold tabular-nums">{row.margin}</span>
        </div>
      </div>
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

type FlowStep = "value" | "reason" | "stepup" | "maker"

export function PricingPage() {
  const query = useSettings("Pricing")
  const settings = useMemo(() => query.data ?? [], [query.data])

  // The currency the spread table's effective-rate preview is shown in (its base rate
  // drives the preview). Base rates for each currency are configured below in the
  // "Base rates" table (the "Add price" surface).
  const currencies = useMemo(() => pricingCurrencies(settings), [settings])
  const [currency, setCurrency] = useState("NGN")
  const previewCurrency = currencies.includes(currency)
    ? currency
    : (currencies[0] ?? "NGN")

  const spreadRows = useMemo(
    () => buildSpreadRows(settings, previewCurrency),
    [settings, previewCurrency]
  )
  const { rows: baseRateRows, options: addOptions } = useMemo(
    () => buildBaseRates(settings),
    [settings]
  )
  const feeSetting = useMemo(
    () => settings.find((s) => s.key === "pricing.processingFeeBps"),
    [settings]
  )
  const feeBps = num(feeSetting)
  const feeLabel = feeBps === null ? "—" : bpsToPct(feeBps)

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  const [target, setTarget] = useState<EditTarget | null>(null)
  const [newValue, setNewValue] = useState("")
  const [step, setStep] = useState<FlowStep | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const parsed = target ? parseValue(newValue, target.integer) : null

  function startEdit(t: EditTarget, fromValueStep = true) {
    setTarget(t)
    setNewValue(t.seed)
    setStep(fromValueStep ? "value" : "reason")
  }
  function closeFlow() {
    setStep(null)
    setTarget(null)
    setNewValue("")
  }

  // ── Edit-target builders ────────────────────────────────────────────────────
  const spreadTarget = (row: SpreadRow): EditTarget => ({
    key: row.spreadKey,
    title: `Edit ${row.cap} spread · ${row.pair}`,
    fieldLabel: "New spread (basis points)",
    currentLabel: row.spread,
    seed: row.spreadBps === null ? "" : String(row.spreadBps),
    scope: row.scope,
    scopeValue: row.scopeValue,
    diffField: `${row.cap} · ${row.pair} spread`,
    toastLabel: `${row.cap} · ${row.pair} spread`,
    format: bpsToPct,
    integer: true,
  })
  const feeTarget = (): EditTarget => ({
    key: "pricing.processingFeeBps",
    title: "Edit processing fee",
    fieldLabel: "New processing fee (basis points)",
    currentLabel: feeLabel,
    seed: feeBps === null ? "" : String(feeBps),
    scope: feeSetting?.scope ?? "global",
    scopeValue: feeSetting?.scopeValue ?? null,
    diffField: "Processing fee",
    toastLabel: "Processing fee",
    format: bpsToPct,
    integer: true,
  })
  const baseRateEditTarget = (row: PricingBaseRateRow): EditTarget => ({
    key: row.key,
    title: `Edit ${row.asset} / ${row.code} base rate`,
    fieldLabel: `New base rate (${row.code} per 1 ${row.asset})`,
    currentLabel: row.label,
    seed: String(row.value),
    scope: row.scope,
    scopeValue: row.scopeValue,
    diffField: `${row.asset} / ${row.code} base rate`,
    toastLabel: `${row.asset} / ${row.code} base rate`,
    format: (n) => formatRate(row.code, n),
    integer: false,
  })
  const baseRateAddTarget = (asset: string, code: string, rate: number): EditTarget => ({
    key: `pricing.assets.${asset}.baseRates.${code}`,
    title: `Add ${asset} / ${code} base rate`,
    fieldLabel: `New base rate (${code} per 1 ${asset})`,
    currentLabel: "—",
    seed: String(rate),
    scope: "global",
    scopeValue: null,
    diffField: `${asset} / ${code} base rate`,
    toastLabel: `${asset} / ${code} base rate`,
    format: (n) => formatRate(code, n),
    integer: false,
  })

  /**
   * Approve the edit. Persists the captured value via the real step-up-guarded PATCH
   * /admin/settings/:key against the target key, carrying its scope. A 403 opens the
   * StepUpDialog and the PATCH replays after re-auth. Nothing moves money (§3.1).
   */
  const approve = () => {
    if (!target || parsed === null) return
    const t = target
    const value = parsed
    closeFlow()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key: t.key,
              input: { value, scope: t.scope, scopeValue: t.scopeValue },
            })
            .then(() => undefined)
        )
        if (ok) pushToast(`${t.toastLabel} → ${t.format(value)}`, "ok")
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
  }

  const flowTitle = target?.title ?? "Edit pricing"
  const diff =
    target && parsed !== null
      ? [{ field: target.diffField, from: target.currentLabel, to: target.format(parsed) }]
      : []

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Page header + editable processing fee ────────────────────────────── */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Pricing
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Per capability × asset × currency. Versioned, schedulable,
            maker-checker. Margin is operator-only — never shown to end users.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Preview currency — drives the effective-rate preview (per-currency base rate). */}
          <label className="flex items-center gap-2 text-[12px] font-bold text-ink2">
            Preview
            <NativeSelect
              aria-label="Preview currency"
              value={previewCurrency}
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
          <div className="flex items-center gap-2 rounded-[12px] border border-line bg-card px-3 py-2">
            <div className="text-right">
              <div className="text-[10px] font-bold tracking-[0.05em] text-ink3 uppercase">
                Processing fee
              </div>
              <div className="font-mono text-[13px] font-bold text-ink tabular-nums">
                {feeLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={() => startEdit(feeTarget())}
              aria-label="Edit processing fee"
              className="rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* ── Spread card (design 7-column grid table) ─────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
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

        {query.isLoading && (
          <div className="divide-y divide-line2" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={cn("grid items-center gap-3 px-[18px] py-[13px]", PRICING_GRID)}
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

        {query.isError && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[14px] font-bold text-tdn">Failed to load pricing</p>
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

        {query.isSuccess && spreadRows.length === 0 && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[14px] font-bold text-ink">No pricing rows</p>
            <p className="mt-1 text-[12.5px] text-ink3">
              No priced assets are configured.
            </p>
          </div>
        )}

        {query.isSuccess &&
          spreadRows.map((row) => (
            <SpreadTableRow
              key={row.id}
              row={row}
              onEdit={(r) => startEdit(spreadTarget(r))}
            />
          ))}
      </div>

      {/* ── Base rates (the "add more prices" surface) ───────────────────────── */}
      <PricingBaseRates
        rows={baseRateRows}
        canAdd={addOptions.length > 0}
        loading={query.isLoading}
        onEdit={(r) => startEdit(baseRateEditTarget(r))}
        onAdd={() => setAddOpen(true)}
      />

      {/* ── Add-price value capture → hands off to the audit chain ───────────── */}
      <AddPriceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        options={addOptions}
        onContinue={({ asset, code, rate }) =>
          startEdit(baseRateAddTarget(asset, code, rate), false)
        }
      />

      {/* ── Funds-safety flow chain: value → reason → step-up → maker-checker ─── */}
      <SettingValueModal
        open={step === "value"}
        onOpenChange={(next) => (next ? undefined : closeFlow())}
        title={flowTitle}
        fieldLabel={target?.fieldLabel ?? "New value"}
        currentValue={target?.currentLabel ?? ""}
        value={newValue}
        onValueChange={setNewValue}
        canContinue={parsed !== null}
        onContinue={() => setStep("reason")}
      />
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
        diff={diff}
        onSubmit={approve}
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
