import { z } from 'zod'
import { FiatAmountSchema, FiatCurrencySchema, SupportedAssetSchema } from '../common'

// The NLU layer emits ONE of these validated intent objects. It is NOT a
// transaction: there is no destination, no final rate, no authorization. The
// deterministic engine turns a confirmed intent into an actual transaction.
export const BuyCryptoIntentSchema = z.object({
  action: z.literal('buy_crypto'),
  asset: SupportedAssetSchema,
  fiatAmount: FiatAmountSchema,
  // Which fiat to spend. Optional: the calling layer defaults to the catalog
  // base fiat when the user names none — never hardcoded here (§7), mirroring
  // GetRateIntentSchema.
  fiatCurrency: FiatCurrencySchema.optional(),
})
export type BuyCryptoIntent = z.infer<typeof BuyCryptoIntentSchema>

// When the model cannot resolve a concrete action it returns `none` so the
// calling layer can ask a clarifying question — it never guesses a transaction.
export const NoIntentSchema = z.object({
  action: z.literal('none'),
  clarification: z.string().min(1).max(500),
})
export type NoIntent = z.infer<typeof NoIntentSchema>

