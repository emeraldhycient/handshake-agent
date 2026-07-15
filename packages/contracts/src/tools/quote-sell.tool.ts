import { z } from 'zod'
import { CryptoAmountSchema, FiatCurrencySchema, SupportedAssetSchema } from '../common'

// Tool I/O contract shared by the agent runtime (typed tool definition) and the
// backend application service that implements it. `quote_sell` is read-only and
// has no side effects — it returns a price quote with a bounded validity window.
export const QuoteSellInputSchema = z.object({
  asset: SupportedAssetSchema,
  cryptoAmount: CryptoAmountSchema,
  // Which fiat the payout settles in. Optional: the calling layer defaults to
  // the catalog base fiat when the caller names none — never hardcoded here
  // (§7), mirroring GetRateIntentSchema.
  fiatCurrency: FiatCurrencySchema.optional(),
})
export type QuoteSellInput = z.infer<typeof QuoteSellInputSchema>

export const QuoteSellOutputSchema = z.object({
  asset: SupportedAssetSchema,
  cryptoAmount: z.string(),
  fiatCurrency: FiatCurrencySchema,
  // The net fiat the user receives and the all-in pricing, itemized for the
  // explicit-confirmation step (PRD §3.2 / §4.3).
  netFiatAmount: z.string(),
  /** Raw market rate (pre-spread) from the rate provider. Distinct from fxRate
   *  which is the effective (spread-inclusive) rate used for conversion. Stored
   *  in the Quote row for treasury / rate-audit purposes. */
  baseRate: z.string(),
  /** Effective (spread-inclusive) FX rate the user receives per unit of crypto. */
  fxRate: z.string(),
  spreadBps: z.number().int().nonnegative(),
  processingFeeBps: z.number().int().nonnegative(),
  processingFeeAmount: z.string(),
  quotedAt: z.string().datetime(),
  expiresInSec: z.number().int().positive(),
})
export type QuoteSellOutput = z.infer<typeof QuoteSellOutputSchema>
