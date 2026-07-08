import { z } from 'zod'
import { CryptoAmountSchema, NetworkSchema, SupportedAssetSchema } from '../common'

// The NLU layer emits this validated intent — not a transaction; the engine
// re-validates and authorizes.
//
// SECURITY (CLAUDE.md §3.1): the NLU layer MUST NOT extract a destination
// address as a financial parameter. The destination address is resolved
// server-side from the user's saved beneficiary record (identified by
// `beneficiaryId` supplied by the calling tool layer — NOT extracted from
// free text). This intent carries only the asset, amount, and (optionally)
// the recipient's saved-beneficiary NICKNAME; the tool layer supplies
// beneficiaryId separately.
export const SendCryptoIntentSchema = z.object({
  action: z.literal('send_crypto'),
  asset: SupportedAssetSchema,
  /** Human-scaled amount the user wants to send (e.g. '10.5'). */
  cryptoAmount: CryptoAmountSchema,
  /** Target blockchain network. Defaults to 'TRON' (TRC-20 USDT at launch). */
  network: NetworkSchema.default('TRON'),
  /**
   * SECURITY (CLAUDE.md §3.1): a LOOKUP KEY only — the recipient's name as the
   * user said it ("send 50 USDT to mum"). It is resolved server-side against
   * the user's OWN saved beneficiaries and yields only a beneficiaryId that the
   * engine re-validates (ownership, type, cooling-off, sanctions, PIN). It is
   * NEVER an address or account number — the NLU layer must not extract those.
   */
  recipientNickname: z.string().trim().min(1).max(60).optional(),
})
export type SendCryptoIntent = z.infer<typeof SendCryptoIntentSchema>
