import { z } from 'zod'
import { CryptoAmountSchema, FiatCurrencySchema, SupportedAssetSchema } from '../common'

// The NLU layer emits ONE of these validated intent objects when the user wants
// to sell crypto for fiat. It is NOT a transaction: there is no destination bank
// account, no final rate, no authorization. The deterministic engine turns a
// confirmed intent into an actual transaction.
export const SellCryptoIntentSchema = z.object({
  action: z.literal('sell_crypto'),
  asset: SupportedAssetSchema,
  cryptoAmount: CryptoAmountSchema,
  fiatCurrency: FiatCurrencySchema.default('NGN'),
})
export type SellCryptoIntent = z.infer<typeof SellCryptoIntentSchema>
