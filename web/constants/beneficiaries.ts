/**
 * Beneficiary bank-country data.
 *
 * The public `/config` payload exposes each enabled fiat's code/symbol/decimals
 * but NOT its country, while the bank-list endpoint is keyed by ISO 3166-1
 * alpha-2 country and the add-bank request carries the ISO 4217 currency. This
 * map bridges the two on the client (it mirrors the server's
 * `AssetRegistry.countryForFiat`). Only currencies present here have a known
 * bank rail, so the bank-account form offers exactly this set.
 *
 * NOTE (drift): the cleaner long-term home is a `country` field on the `/config`
 * fiat entries so the FE never hardcodes this — surfaced in the task notes.
 */
export const FIAT_COUNTRY: Readonly<Record<string, string>> = {
  NGN: "NG",
  GHS: "GH",
  KES: "KE",
  UGX: "UG",
  TZS: "TZ",
  RWF: "RW",
  ZAR: "ZA",
  USD: "US",
} as const

/** Display names for the bank countries above (selector label + a11y). */
export const COUNTRY_NAME: Readonly<Record<string, string>> = {
  NG: "Nigeria",
  GH: "Ghana",
  KE: "Kenya",
  UG: "Uganda",
  TZ: "Tanzania",
  RW: "Rwanda",
  ZA: "South Africa",
  US: "United States",
} as const

/** The fiat used when neither config nor profile has resolved yet. */
export const DEFAULT_BANK_CURRENCY = "NGN"
