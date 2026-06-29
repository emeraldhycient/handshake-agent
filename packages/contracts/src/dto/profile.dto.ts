import { z } from 'zod'
import { FiatCurrencySchema } from '../common'

export const ProfileLimitsSchema = z.object({
  perTxFiatMax: z.number(),
  dailyFiatMax: z.number(),
  dailyTxCountMax: z.number(),
})
export type ProfileLimits = z.infer<typeof ProfileLimitsSchema>

export const ProfileResponseSchema = z.object({
  email: z.string().email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  kycStatus: z.string(),
  kycTier: z.string(),
  fiatCurrency: FiatCurrencySchema,
  limits: ProfileLimitsSchema.nullable(),
})
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>
