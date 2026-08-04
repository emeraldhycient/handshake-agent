import type { EffectiveSetting } from "@handshake-agent/contracts"

import { formatFiat } from "@/lib/format"
import { NO_KEY, TIER_META } from "@/constants/limits"
import type {
  LimitAmountRow,
  LimitLeafKind,
  LimitTier,
  LimitVelocityRow,
} from "@/types"

/** Humanize a seconds duration for display (e.g. 86400 → "24h", 0 → "None"). */
export function humanizeSeconds(s: number): string {
  if (s === 0) return "None"
  if (s % 86400 === 0) return `${s / 86400}d`
  if (s % 3600 === 0) return `${s / 3600}h`
  if (s % 60 === 0) return `${s / 60}m`
  return `${s}s`
}

/** Format a numeric leaf value by its kind (fiat amount / plain count / duration). */
export function formatLeaf(
  kind: LimitLeafKind,
  n: number,
  currency: string
): string {
  if (kind === "amount") return formatFiat(n, currency)
  if (kind === "count") return n.toLocaleString()
  return humanizeSeconds(n)
}

/** The edit field's label + a11y name for a leaf kind (units are explicit). */
export function fieldLabelFor(kind: LimitLeafKind, currency: string): string {
  if (kind === "amount") return `New value (${currency})`
  if (kind === "count") return "New value (count)"
  return "New value (seconds)"
}

/**
 * Build a key/value row. A row is EDITABLE whenever its config key is PRESENT in the read
 * (registered + enforced-when-present) — even if the value is unset ("Not set"), so an
 * operator can configure a currency's limits from scratch. A key ABSENT from the read
 * (not registered) renders "—" with no editor (§3.6 guard).
 */
export function leafRow(
  label: string,
  setting: EffectiveSetting | undefined,
  kind: LimitLeafKind,
  currency: string
): LimitAmountRow {
  if (setting === undefined) return { k: label, v: NO_KEY }
  const value = setting.value
  return {
    k: label,
    v:
      typeof value === "number" ? formatLeaf(kind, value, currency) : "Not set",
    edit: {
      key: setting.key,
      scope: setting.scope,
      scopeValue: setting.scopeValue,
      kind,
    },
  }
}

/**
 * Build the per-tier cards for `currency`. Amount caps map the per-currency, per-tier keys
 * (`limits.<currency>.<tier>.*`); the two cooling-offs are GLOBAL leaves shown on every card.
 */
export function buildTiers(
  settings: readonly EffectiveSetting[],
  currency: string
): LimitTier[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  const benefHold = byKey.get("beneficiary.cryptoCoolingOffSeconds")
  const tierChangeHold = byKey.get("compliance.tierChangeCoolingOffSeconds")
  return TIER_META.map(({ id, label }) => {
    const base = `limits.${currency}.${id}`
    const amountCaps: LimitAmountRow[] = [
      leafRow(
        "Per-transaction max",
        byKey.get(`${base}.perTxFiatMax`),
        "amount",
        currency
      ),
      leafRow(
        "Daily max · rolling 24h",
        byKey.get(`${base}.dailyFiatMax`),
        "amount",
        currency
      ),
      leafRow(
        "Weekly max · rolling 7d",
        byKey.get(`${base}.weeklyFiatMax`),
        "amount",
        currency
      ),
      leafRow(
        "Single on-chain send max",
        byKey.get(`${base}.perSendOnChainFiatMax`),
        "amount",
        currency
      ),
    ]
    const velocity: LimitVelocityRow[] = [
      leafRow(
        "Transactions / day",
        byKey.get(`${base}.dailyTxCountMax`),
        "count",
        currency
      ),
      leafRow(
        "Sends / 10-min window",
        byKey.get(`${base}.sendsPer10MinMax`),
        "count",
        currency
      ),
      leafRow(
        "Cooling-off after tier change",
        tierChangeHold,
        "seconds",
        currency
      ),
      leafRow("New-beneficiary hold", benefHold, "seconds", currency),
    ]
    return { id, label, amountCaps, velocity }
  })
}

/**
 * Distinct fiat codes that have registered `limits.<code>.*` keys in the read,
 * with `defaultFiat` (the catalog's configured default — never a hardcoded
 * 'NGN' literal) pinned first.
 */
export function availableCurrencies(
  settings: readonly EffectiveSetting[],
  defaultFiat: string
): string[] {
  const codes = new Set<string>()
  for (const s of settings) {
    const m = /^limits\.([A-Z]{3})\./.exec(s.key)
    if (m) codes.add(m[1])
  }
  return [...codes].sort((a, b) =>
    a === defaultFiat ? -1 : b === defaultFiat ? 1 : a.localeCompare(b)
  )
}

/** Parse a limit input (plain non-negative integer) → a number, else null. */
export function parseCap(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 0 ? n : null
}
