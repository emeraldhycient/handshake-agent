/**
 * Derive the add-bank currency/country selector options from the enabled fiats
 * in `/config`, and pick a sensible default. Pure — no hooks, no I/O — so it is
 * unit-testable and reused by the form orchestrator.
 */
import {
  FIAT_COUNTRY,
  COUNTRY_NAME,
  DEFAULT_BANK_CURRENCY,
} from "@/constants/beneficiaries"
import type { BankFiatOption } from "@/types/chat"

function toOption(currency: string): BankFiatOption {
  const country = FIAT_COUNTRY[currency] ?? FIAT_COUNTRY[DEFAULT_BANK_CURRENCY]
  const name = COUNTRY_NAME[country] ?? country
  return { currency, country, label: `${name} (${currency})` }
}

/**
 * Enabled fiats that have a known bank country, as selector options. When
 * config has not resolved (or none qualify) we fall back to the single currency
 * we always support so the form is never optionless.
 */
export function buildBankFiatOptions(
  fiats: readonly { code: string }[] | undefined
): BankFiatOption[] {
  const known = (fiats ?? [])
    .filter((f) => FIAT_COUNTRY[f.code])
    .map((f) => toOption(f.code))
  return known.length > 0 ? known : [toOption(DEFAULT_BANK_CURRENCY)]
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
