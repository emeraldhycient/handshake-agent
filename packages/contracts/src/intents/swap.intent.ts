import { z } from 'zod'
import { FiatCurrencySchema, SupportedAssetSchema } from '../common'

export const SwapIntentSchema = z.object({
  action: z.literal('swap'),
  fromAsset: SupportedAssetSchema,
  toCurrency: FiatCurrencySchema.default('NGN'),
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, 'Enter a valid amount'),
})
export type SwapIntent = z.infer<typeof SwapIntentSchema>
