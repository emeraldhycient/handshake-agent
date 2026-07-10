/**
 * Beneficiary bank-country data.
 *
 * The public `/config` payload now carries each enabled fiat's ISO 3166-1
 * alpha-2 `country` (mirrors the server's `AssetRegistry.countryForFiat`), so
 * the currency→country mapping is NO LONGER duplicated on the client — the
 * add-bank form derives country straight from the `/config` fiats. What remains
 * here is UI copy (country display names for the selector label) plus the single
 * synchronous fallback used before `/config` has resolved.
 */

/** Human-readable country names for the bank-country selector label + a11y. */
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

/** The country paired with {@link DEFAULT_BANK_CURRENCY} for the offline fallback. */
export const DEFAULT_BANK_COUNTRY = "NG"
