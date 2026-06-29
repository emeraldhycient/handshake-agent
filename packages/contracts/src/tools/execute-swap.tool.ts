import { z } from 'zod'
import { SupportedAssetSchema } from '../common'

// Itemized confirmation object returned by ProposalService.createSwapProposal.
// Rendered by the web confirmation step — all monetary values are strings so
// they cross the wire without float coercion.
//
// FX spread is NEVER surfaced as a line item (spec §3 / root CLAUDE.md §3.1).
// The `rate` here is the effective provider rate (spread already folded in
// via config swapSpreadBps at the engine layer).
export const SwapProposalConfirmationSchema = z.object({
  proposalId: z.string().uuid(),
  fromAsset: SupportedAssetSchema,
  toAsset: SupportedAssetSchema,
  /** Human-scaled amount being swapped out of the fromAsset wallet. */
  fromAmount: z.string(),
  /** Estimated amount to be credited in toAsset after the swap. */
  toAmount: z.string(),
  /** Effective exchange rate: 1 fromAsset = rate toAsset. */
  rate: z.string(),
  /** On-chain network fee in fromAsset (decimal string). */
  networkFee: z.string(),
  /** Provider transaction fee in fromAsset (decimal string). */
  transactionFee: z.string(),
  /** Estimated arrival time in seconds (from swap submission). */
  estimatedArrivalSec: z.number().int().nonnegative(),
  /** ISO 8601 expiry timestamp for the proposal. */
  expiresAt: z.string().datetime(),
})

export type SwapProposalConfirmation = z.infer<typeof SwapProposalConfirmationSchema>
