import { z } from 'zod'
import { NetworkSchema, SupportedAssetSchema } from '../common'

// The NLU layer emits this validated intent — not a transaction; the engine
// re-validates and authorizes.
export const ReceiveCryptoIntentSchema = z.object({
  action: z.literal('receive_crypto'),
  // asset is optional — the model may not name one; the service falls back to
  // the registry default asset when absent.
  asset: SupportedAssetSchema.optional(),
  network: NetworkSchema.default('TRON'),
})
export type ReceiveCryptoIntent = z.infer<typeof ReceiveCryptoIntentSchema>
