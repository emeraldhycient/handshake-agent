import { z } from 'zod'

// Launch scope is intentionally narrow (PRD §12): a couple of assets, NGN only.
// Widen these enums as the supported set grows — every consumer updates from here.
export const SupportedAssetSchema = z.enum(['USDT', 'BTC'])
export type SupportedAsset = z.infer<typeof SupportedAssetSchema>

export const FiatCurrencySchema = z.enum(['NGN'])
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
