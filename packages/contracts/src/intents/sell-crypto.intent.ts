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
  /**
   * SECURITY (CLAUDE.md §3.1): a LOOKUP KEY only — the payout recipient's name
   * as the user said it ("sell 100 USDT to my GTB account"). It is resolved
   * server-side against the user's OWN saved bank-account beneficiaries and
   * yields only a beneficiaryId that the engine re-validates (ownership, type,
   * sanctions, PIN). It is NEVER a bank account number — the NLU layer must
   * not extract account numbers or addresses.
   */
  recipientNickname: z.string().trim().min(1).max(60).optional(),
})
export type SellCryptoIntent = z.infer<typeof SellCryptoIntentSchema>
