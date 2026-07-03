import { z } from 'zod'

// SupportedAsset: the full set of crypto assets this system recognises.
// Which are actually LIVE is governed by the catalog `enabled` flag (config-gated).
// TRX is included as the TRON network-fee currency — a primary swap target
// for users wanting USDT→TRX to fund on-chain activity.
export const SupportedAssetSchema = z.enum(['USDT', 'BTC', 'TRX'])
export type SupportedAsset = z.infer<typeof SupportedAssetSchema>

// FiatCurrency: currency validation is CATALOG-DRIVEN, not a fixed enum. The schema
// accepts any well-formed 3-letter code; the SERVER re-validates it against the live
// catalog (AssetRegistry) — an unknown or disabled currency is rejected fail-closed at
// the money-path boundary (§3.3), and only an ACTIVE catalog fiat with pricing can
// settle. This lets operators ADD currencies at runtime ("Add currency" → CustomFiat
// overlay) without a code change. `KNOWN_FIAT_CURRENCIES` is the built-in (JSON-default
// catalog) set, used only where the code must ENUMERATE the built-ins (registry keys,
// defaults) — never as the validation boundary.
export const KNOWN_FIAT_CURRENCIES = [
  'NGN',
  'GHS',
  'KES',
  'UGX',
  'TZS',
  'RWF',
  'ZAR',
  'USD',
] as const

export const FiatCurrencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'must be a 3-letter uppercase currency code')
export type FiatCurrency = z.infer<typeof FiatCurrencySchema>

// Money is carried as a validated string until the execution boundary, then
// coerced once. Never round-trip currency through a float on the way in.
export const FiatAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount')

// Crypto carries up to 8 d.p. (vs FiatAmountSchema's 2 d.p.) to
// accommodate satoshi-level precision for BTC and similar assets.
export const CryptoAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, 'Enter a valid amount')

// On-chain networks supported for sends/receives.
// TRON is the launch default (TRC-20 USDT); widen as new networks are enabled.
export const NetworkSchema = z.enum(['TRON'])

export const IdempotencyKeySchema = z.string().uuid()
