import { z } from 'zod'
import { CryptoAmountSchema, NetworkSchema, SupportedAssetSchema } from '../common'

// Tool I/O contract for the `quote_send` tool (task N1).
// `quote_send` is read-only — it computes the on-chain network fee and total
// debit for a send, with a bounded validity window. No funds move here.

export const QuoteSendInputSchema = z.object({
  /** Crypto asset symbol (e.g. 'USDT'). */
  asset: SupportedAssetSchema,
  /** Human-scaled amount the user wants to send (e.g. '10.5'). */
  cryptoAmount: CryptoAmountSchema,
  /** Target blockchain network. Must be enabled for the asset in the catalog. */
  network: NetworkSchema,
})
export type QuoteSendInput = z.infer<typeof QuoteSendInputSchema>

export const QuoteSendOutputSchema = z.object({
  asset: SupportedAssetSchema,
  /** Amount the user specified to send. */
  cryptoAmount: z.string(),
  network: NetworkSchema,
  /**
   * Flat on-chain network fee in the same asset (e.g. '1' USDT for TRC-20).
   * Config-driven: stored in `catalog.networks.<id>.networkFeeCrypto.<asset>`.
   * Admin-tunable (AppSetting layer, CLAUDE.md §7) without a deploy.
   */
  networkFeeCrypto: z.string(),
  /**
   * Total debit from the user's wallet: cryptoAmount + networkFeeCrypto.
   * Computed with BigInt arithmetic (decimal-safe, no float drift).
   */
  totalDebit: z.string(),
  /** ISO 8601 timestamp when this quote was generated. */
  quotedAt: z.string().datetime(),
  /** Validity window in seconds. After this the caller must re-quote. */
  expiresInSec: z.number().int().positive(),
})
export type QuoteSendOutput = z.infer<typeof QuoteSendOutputSchema>
