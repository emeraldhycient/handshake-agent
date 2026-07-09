/**
 * Derive the add-bank currency/country selector options from the enabled fiats
 * in `/config`, and pick a sensible default. Pure — no hooks, no I/O — so it is
 * unit-testable and reused by the form orchestrator. The country now comes from
 * each fiat's `/config` `country` field (server-derived), not a hardcoded map.
 */
import {
  COUNTRY_NAME,
  DEFAULT_BANK_CURRENCY,
  DEFAULT_BANK_COUNTRY,
} from "@/constants/beneficiaries"
import type { BankFiatOption } from "@/types/chat"

function toOption(currency: string, country: string): BankFiatOption {
  const name = COUNTRY_NAME[country] ?? country
  return { currency, country, label: `${name} (${currency})` }
}

/**
 * Enabled fiats that carry a bank-rail country (from `/config`), as selector
 * options. A fiat without a `country` mapping has no known bank rail and is
 * dropped. When config has not resolved (or none qualify) we fall back to the
 * single currency we always support so the form is never optionless.
 */
export function buildBankFiatOptions(
  fiats: readonly { code: string; country?: string }[] | undefined
): BankFiatOption[] {
  const known = (fiats ?? [])
    .filter((f): f is { code: string; country: string } => Boolean(f.country))
    .map((f) => toOption(f.code, f.country))
  return known.length > 0
    ? known
    : [toOption(DEFAULT_BANK_CURRENCY, DEFAULT_BANK_COUNTRY)]
}

/** Prefer the user's profile currency when it is a valid option; else the first. */
export function pickDefaultCurrency(
  options: BankFiatOption[],
  preferred?: string
): string {
  return (
    options.find((o) => o.currency === preferred)?.currency ??
    options[0]?.currency ??
    DEFAULT_BANK_CURRENCY
  )
}
