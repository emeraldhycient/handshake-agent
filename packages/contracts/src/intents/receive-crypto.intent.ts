import { z } from 'zod'
import { SupportedAssetSchema } from '../common'
import { NetworkSchema } from './send-crypto.intent'

export const ReceiveCryptoIntentSchema = z.object({
  action: z.literal('receive_crypto'),
  asset: SupportedAssetSchema,
  network: NetworkSchema.default('TRON'),
})
export type ReceiveCryptoIntent = z.infer<typeof ReceiveCryptoIntentSchema>
