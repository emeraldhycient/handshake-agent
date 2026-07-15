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
   * OPTIONAL: an internal (PayID) user→user transfer has no on-chain address —
   * it is legible via `recipientDisplayName` + `recipientHandle` instead (Task 6).
   */
  toAddressMasked: z.string().optional(),
  /** Optional human-readable label for the destination (beneficiary name, etc.). */
  beneficiaryLabel: z.string().optional(),
  /**
   * Recipient's display name for an internal (PayID) transfer — the resolved
   * KYC name of the counterparty user. Absent for on-chain sends.
   */
  recipientDisplayName: z.string().optional(),
  /**
   * Recipient's public handle (PayID) for an internal transfer. Absent for
   * on-chain sends. The handle is a server-resolved lookup key (CLAUDE.md §6) —
   * never a raw address extracted by the model.
   */
  recipientHandle: z.string().optional(),
  /**
   * True for an internal (in-custody, user→user ledger) transfer that settles
   * instantly with no on-chain confirmation wait. Absent/false for on-chain sends.
   */
  instant: z.boolean().optional(),
  /** ISO 8601 expiry timestamp for the proposal. */
  expiresAt: z.string().datetime(),
})

export type SendProposalConfirmation = z.infer<typeof SendProposalConfirmationSchema>
