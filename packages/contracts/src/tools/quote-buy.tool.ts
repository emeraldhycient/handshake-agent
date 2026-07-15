import { z } from 'zod'
import { FiatAmountSchema, FiatCurrencySchema, SupportedAssetSchema } from '../common'

// Tool I/O contract shared by the agent runtime (typed tool definition) and the
// backend application service that implements it. `quote_buy` is read-only and
// has no side effects — it returns a price quote with a bounded validity window.
export const QuoteBuyInputSchema = z.object({
  asset: SupportedAssetSchema,
  fiatAmount: FiatAmountSchema,
  // Which fiat to spend. Optional: the calling layer defaults to the catalog
  // base fiat when the caller names none — never hardcoded here (§7),
  // mirroring GetRateIntentSchema.
  fiatCurrency: FiatCurrencySchema.optional(),
})
export type QuoteBuyInput = z.infer<typeof QuoteBuyInputSchema>

export const QuoteBuyOutputSchema = z.object({
  asset: SupportedAssetSchema,
  fiatAmount: FiatAmountSchema,
  fiatCurrency: FiatCurrencySchema,
  // The crypto the user receives and the all-in pricing, itemized for the
  // explicit-confirmation step (PRD §3.2 / §4.3).
  cryptoAmount: z.string(),
  /** Raw market rate (pre-spread) from the rate provider. Distinct from fxRate
   *  which is the effective (spread-inclusive) rate used for conversion. Stored
   *  in the Quote row for treasury / rate-audit purposes. */
  baseRate: z.string(),
  /** Effective (spread-inclusive) FX rate used to convert fiat → crypto. */
  fxRate: z.string(),
  spreadBps: z.number().int().nonnegative(),
  processingFeeBps: z.number().int().nonnegative(),
  quotedAt: z.string().datetime(),
  expiresInSec: z.number().int().positive(),
})
export type QuoteBuyOutput = z.infer<typeof QuoteBuyOutputSchema>
