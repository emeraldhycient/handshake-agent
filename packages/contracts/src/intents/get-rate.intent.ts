import { z } from 'zod'
import { FiatCurrencySchema, SupportedAssetSchema } from '../common'

// Read-only rate-discovery intent (Wave K). The user asks for ONE pair's price
// ("what's the USDT/NGN rate?", "how much is 1 USDT in naira?"). It is NOT a
// transaction: it moves no money and carries no amount, destination, or
// authorization (CLAUDE.md §3.1). The calling layer reads RatesService and
// replies with the folded buy + sell figure the engine actually transacts at.
export const GetRateIntentSchema = z.object({
  action: z.literal('get_rate'),
  // A single-pair rate question always names its crypto asset.
  asset: SupportedAssetSchema,
  // Which fiat to price against. Optional: the calling layer defaults to the
  // catalog base fiat when the user names none — never hardcoded here (§7).
  fiatCurrency: FiatCurrencySchema.optional(),
})
export type GetRateIntent = z.infer<typeof GetRateIntentSchema>
