import { z } from 'zod'
import { CryptoAmountSchema, FiatCurrencySchema, SupportedAssetSchema } from '../common'

// The NLU layer emits this validated intent — not a transaction; the engine
// re-validates and authorizes.
export const SwapIntentSchema = z.object({
  action: z.literal('swap'),
  fromAsset: SupportedAssetSchema,
  toCurrency: FiatCurrencySchema.default('NGN'),
  amount: CryptoAmountSchema,
})
export type SwapIntent = z.infer<typeof SwapIntentSchema>
