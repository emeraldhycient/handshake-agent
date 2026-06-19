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

export const IdempotencyKeySchema = z.string().uuid()
