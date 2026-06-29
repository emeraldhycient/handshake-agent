import { z } from 'zod'

// SupportedAsset: the full set of crypto assets this system recognises.
// Which are actually LIVE is governed by the catalog `enabled` flag (config-gated).
// TRX is included as the TRON network-fee currency — a primary swap target
// for users wanting USDT→TRX to fund on-chain activity.
export const SupportedAssetSchema = z.enum(['USDT', 'BTC', 'TRX'])
export type SupportedAsset = z.infer<typeof SupportedAssetSchema>

// FiatCurrency: the SUPPORTED currency set for the entire platform.
// Which currencies are actually LIVE (i.e. can settle real transactions) is
// governed by the catalog `enabled` flag in the layered config (CLAUDE.md §7),
// not this enum. Adding a currency here means the system recognises it;
// flipping its catalog `enabled` flag to true makes it live.
// At launch: NGN is the only LIVE currency — all others are enabled:false in config.
export const FiatCurrencySchema = z.enum(['NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZAR', 'USD'])
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
