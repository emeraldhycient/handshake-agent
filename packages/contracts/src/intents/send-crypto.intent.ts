import { z } from 'zod'
import { CryptoAmountSchema, NetworkSchema, SupportedAssetSchema } from '../common'

// The NLU layer emits this validated intent — not a transaction; the engine
// re-validates and authorizes.
export const SendCryptoIntentSchema = z.object({
  action: z.literal('send_crypto'),
  asset: SupportedAssetSchema,
  amount: CryptoAmountSchema,
  network: NetworkSchema.default('TRON'),
  // Loose validation by design: the deterministic engine is the authoritative
  // on-chain address check; the NLU layer only ensures a non-trivial string.
  address: z.string().min(20),
})
export type SendCryptoIntent = z.infer<typeof SendCryptoIntentSchema>
