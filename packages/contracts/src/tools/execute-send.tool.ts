import { z } from 'zod'
import { NetworkSchema, SupportedAssetSchema } from '../common'

// Itemized confirmation object for the send flow (task N1).
// Rendered by the WhatsApp Flow / web confirmation step — the destination address
// is MASKED here (`toAddressMasked`) so the full address is never exposed in the
// chat thread or confirmation UI. The full address is held server-side and only
// used at execution time after PIN + step-up auth (CLAUDE.md §3.1 / §3.5).

export const SendProposalConfirmationSchema = z.object({
  proposalId: z.string().uuid(),
  asset: SupportedAssetSchema,
  /** Amount to send (excluding fees). */
  cryptoAmount: z.string(),
  network: NetworkSchema,
  /** On-chain network fee in the same asset. */
  networkFeeCrypto: z.string(),
  /** Total wallet debit: cryptoAmount + networkFeeCrypto. */
  totalDebit: z.string(),
  /**
   * Masked destination address for display in the confirmation UI.
   * Format: first 6 chars + '...' + last 4 chars (e.g. 'TRX123...abcd').
   * The full address is held server-side only (CLAUDE.md §3.5).
   */
  toAddressMasked: z.string(),
  /** Optional human-readable label for the destination (beneficiary name, etc.). */
  beneficiaryLabel: z.string().optional(),
  /** ISO 8601 expiry timestamp for the proposal. */
  expiresAt: z.string().datetime(),
})

export type SendProposalConfirmation = z.infer<typeof SendProposalConfirmationSchema>
