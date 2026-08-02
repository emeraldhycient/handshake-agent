import type { EffectiveSetting } from "@handshake-agent/contracts"

import { formatFiat } from "@/lib/format"
import { BASE_RATE_RE, PRICED_ASSETS } from "@/constants/pricing"
import type {
  AddPriceOption,
  PricingBaseRateRow,
  PricingCap,
  SpreadRow,
} from "@/types"

/** basis points → a 2-decimal percent label (150 → "1.50%"). */
export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

/** The numeric value of a setting, or null when absent / non-numeric. */
export function num(setting: EffectiveSetting | undefined): number | null {
  return setting && typeof setting.value === "number" ? setting.value : null
}

/** A base rate label — "1,375 NGN" / "19.5 GHS" (up to 6 dp, code-suffixed). */
export function formatRate(code: string, n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${code}`
}

/** Parse the captured value: a finite non-negative number (whole when `integer`). */
export function parseValue(input: string, integer: boolean): number | null {
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
export function buildSpreadRows(
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
      return formatFiat(baseRate * factor, currency)
    }
    const margin = (spreadBps: number | null) => {
      const spreadPct = spreadBps === null ? 0 : spreadBps / 100
      const feePct = feeBps === null ? 0 : feeBps / 100
      return `${(spreadPct + feePct).toFixed(2)}%`
    }
    const mk = (
      dir: PricingCap,
      bpsVal: number | null,
      setting?: EffectiveSetting
    ): SpreadRow => {
      const minKey = `${base}.minFiat.${dir}.${currency}`
      const maxKey = `${base}.maxFiat.${dir}.${currency}`
      return {
        id: `${asset}-${dir}`,
        cap: `crypto.${dir}`,
        pair: `${asset} / ${currency}`,
        spread: bpsVal === null ? "—" : bpsToPct(bpsVal),
        fee: feeLabel,
        userRate: derive(bpsVal, dir),
        margin: margin(bpsVal),
        spreadKey: `${base}.${dir}SpreadBps`,
        spreadBps: bpsVal,
        scope: setting?.scope ?? "global",
        scopeValue: setting?.scopeValue ?? null,
        dir,
        asset,
        currency,
        minKey,
        maxKey,
        minValue: num(byKey.get(minKey)),
        maxValue: num(byKey.get(maxKey)),
      }
    }
    rows.push(mk("buy", buyBps, buySetting), mk("sell", sellBps, sellSetting))
  }
  return rows
}

/**
 * Distinct fiat codes that have any base rate registered in the read, with
 * `defaultFiat` (the catalog's configured default — never a hardcoded 'NGN'
 * literal) pinned first.
 */
export function pricingCurrencies(
  settings: readonly EffectiveSetting[],
  defaultFiat: string
): string[] {
  const codes = new Set<string>()
  for (const s of settings) {
    const m = /^pricing\.assets\.[A-Za-z0-9]+\.baseRates\.([A-Z]{3})$/.exec(
      s.key
    )
    if (m) codes.add(m[1])
  }
  if (codes.size === 0) codes.add(defaultFiat)
  return [...codes].sort((a, b) =>
    a === defaultFiat ? -1 : b === defaultFiat ? 1 : a.localeCompare(b)
  )
}

/** Split base-rate settings into configured rows (value present) and unpriced options. */
export function buildBaseRates(settings: readonly EffectiveSetting[]): {
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
  const byAssetThenCode = (
    a: { asset: string; code: string },
    b: { asset: string; code: string }
  ) => a.asset.localeCompare(b.asset) || a.code.localeCompare(b.code)
  rows.sort(byAssetThenCode)
  options.sort(byAssetThenCode)
  return { rows, options }
}
