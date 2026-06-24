import { z } from 'zod'
import {
  FiatCurrencySchema,
  SupportedAssetSchema,
} from '../common'

// Itemized confirmation object returned by ProposalService.createSellProposal.
// Rendered by the WhatsApp Flow / web confirmation step — all monetary values
// are strings so they cross the wire without float coercion.
export const SellProposalConfirmationSchema = z.object({
  proposalId: z.string().uuid(),
  asset: SupportedAssetSchema,
  cryptoAmount: z.string(),
  fiatCurrency: FiatCurrencySchema,
  netFiatAmount: z.string(),
  /** Effective (spread-inclusive) FX rate the user receives per unit of crypto. */
  fxRate: z.string(),
  processingFeeAmount: z.string(),
  expiresAt: z.string().datetime(),
  /** Optional label for the destination bank account / beneficiary. */
  beneficiaryLabel: z.string().optional(),
})

export type SellProposalConfirmation = z.infer<typeof SellProposalConfirmationSchema>
