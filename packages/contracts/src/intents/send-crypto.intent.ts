import { z } from 'zod'
import { SupportedAssetSchema } from '../common'

// Networks supported for on-chain sends. TRON is the launch default (TRC-20
// USDT). Widen as additional networks are enabled in the service registry.
export const NetworkSchema = z.enum(['TRON'])

export const SendCryptoIntentSchema = z.object({
  action: z.literal('send_crypto'),
  asset: SupportedAssetSchema,
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, 'Enter a valid amount'),
  network: NetworkSchema.default('TRON'),
  address: z.string().min(20),
})
export type SendCryptoIntent = z.infer<typeof SendCryptoIntentSchema>
