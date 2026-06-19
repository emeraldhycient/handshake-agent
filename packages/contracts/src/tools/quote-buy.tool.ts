import { z } from 'zod'
import { FiatAmountSchema, FiatCurrencySchema, SupportedAssetSchema } from '../common'

// Tool I/O contract shared by the agent runtime (typed tool definition) and the
// backend application service that implements it. `quote_buy` is read-only and
// has no side effects — it returns a price quote with a bounded validity window.
export const QuoteBuyInputSchema = z.object({
  asset: SupportedAssetSchema,
  fiatAmount: FiatAmountSchema,
  fiatCurrency: FiatCurrencySchema.default('NGN'),
})
export type QuoteBuyInput = z.infer<typeof QuoteBuyInputSchema>

export const QuoteBuyOutputSchema = z.object({
  asset: SupportedAssetSchema,
  fiatAmount: FiatAmountSchema,
  fiatCurrency: FiatCurrencySchema,
  // The crypto the user receives and the all-in pricing, itemized for the
  // explicit-confirmation step (PRD §3.2 / §4.3).
  cryptoAmount: z.string(),
  fxRate: z.string(),
  spreadBps: z.number().int().nonnegative(),
  processingFeeBps: z.number().int().nonnegative(),
  quotedAt: z.string().datetime(),
  expiresInSec: z.number().int().positive(),
})
export type QuoteBuyOutput = z.infer<typeof QuoteBuyOutputSchema>
