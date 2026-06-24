import { z } from 'zod'
import {
  FiatCurrencySchema,
  SupportedAssetSchema,
} from '../common'

// Itemized confirmation object returned by ProposalService.createBuyProposal.
// Rendered by the WhatsApp Flow / web confirmation step — all monetary values
// are strings so they cross the wire without float coercion.
export const BuyProposalConfirmationSchema = z.object({
  proposalId: z.string().uuid(),
  asset: SupportedAssetSchema,
  fiatAmount: z.string(),
  fiatCurrency: FiatCurrencySchema,
  cryptoAmount: z.string(),
  fxRate: z.string(),
  spreadBps: z.number().int().nonnegative(),
  processingFeeBps: z.number().int().nonnegative(),
  processingFeeAmount: z.string(),
  totalFiat: z.string(),
  expiresAt: z.string().datetime(),
})

export type BuyProposalConfirmation = z.infer<typeof BuyProposalConfirmationSchema>
