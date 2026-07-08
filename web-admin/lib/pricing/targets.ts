import type { EffectiveSetting } from "@handshake-agent/contracts"

import { formatFiat } from "@/lib/format"
import { bpsToPct, formatRate } from "@/lib/pricing/rows"
import type {
  EditTarget,
  PricingBaseRateRow,
  SpreadRow,
} from "@/types/components"

/** Edit-target for a Buy/Sell spread (whole basis points). */
export function spreadTarget(row: SpreadRow): EditTarget {
  return {
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
  }
}

/**
 * Edit-target for a per-(capability × asset × currency) fiat MIN/MAX bound. Persists to a
 * registered `pricing.assets.<A>.{min,max}Fiat.<cap>.<ccy>` key the engine enforces
 * server-side (§3.6) — the editor is safe precisely because the guard exists.
 */
export function boundTarget(row: SpreadRow, kind: "min" | "max"): EditTarget {
  const isMin = kind === "min"
  const value = isMin ? row.minValue : row.maxValue
  return {
    key: isMin ? row.minKey : row.maxKey,
    title: `Edit ${row.cap} ${kind} · ${row.pair}`,
    fieldLabel: `New ${isMin ? "minimum" : "maximum"} (${row.currency})`,
    currentLabel: value !== null ? formatFiat(value, row.currency) : "—",
    seed: value === null ? "" : String(value),
    scope: "global",
    scopeValue: null,
    diffField: `${row.cap} · ${row.pair} ${kind}`,
    toastLabel: `${row.cap} · ${row.pair} ${kind}`,
    format: (n) => formatFiat(n, row.currency),
    integer: false,
  }
}

/** Edit-target for the global processing fee (whole basis points). */
export function feeTarget(
  feeSetting: EffectiveSetting | undefined,
  feeBps: number | null,
  feeLabel: string
): EditTarget {
  return {
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
  }
}

/** Edit-target for editing an existing base rate. */
export function baseRateEditTarget(row: PricingBaseRateRow): EditTarget {
  return {
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
  }
}

/** Edit-target for adding a new (asset × currency) base rate. */
export function baseRateAddTarget(
  asset: string,
  code: string,
  rate: number
): EditTarget {
  return {
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
  }
}
