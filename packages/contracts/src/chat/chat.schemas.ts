import { z } from 'zod'
import { BuyProposalConfirmationSchema } from '../tools/execute-buy.tool'
import { SellProposalConfirmationSchema } from '../tools/execute-sell.tool'
import { SendProposalConfirmationSchema } from '../tools/execute-send.tool'
import { SwapProposalConfirmationSchema } from '../tools/execute-swap.tool'
import { TransactionHistoryResponseSchema } from '../transactions/transaction-history.schema'
import { FiatCurrencySchema } from '../common'

// Request body sent from the web chat UI to POST /agent/chat.
export const ChatMessageRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  // Optional: pre-selected beneficiary so the agent can skip the lookup step.
  beneficiaryId: z.string().uuid().optional(),
})
export type ChatMessageRequest = z.infer<typeof ChatMessageRequestSchema>

// One asset's balance line within a balance snapshot.
// `amount` is a human-scaled crypto amount string (e.g. "10.5"); `fiatValue` is a
// mid-market valuation in the snapshot's `fiatCurrency` (decimal string), omitted
// when the asset cannot be priced. The FX spread is NEVER surfaced here (§ user rule).
export const BalanceLineSchema = z.object({
  asset: z.string(),
  network: z.string(),
  amount: z.string(),
  fiatValue: z.string().optional(),
})
export type BalanceLine = z.infer<typeof BalanceLineSchema>

// Read-only portfolio snapshot the balance service returns. The web-chat / WhatsApp
// layers spread this into a `balance` outcome (adding `kind`). `asset` echoes the
// single asset when the user scoped their request; absent = all supported assets.
export const BalanceSnapshotSchema = z.object({
  fiatCurrency: z.string(),
  asset: z.string().optional(),
  totalFiatValue: z.string().optional(),
  balances: z.array(BalanceLineSchema),
})
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>

// Discriminated union describing what the agent turn resolved to.
// The web UI branches on `kind` to decide which confirmation component to render.
export const AgentTurnOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clarification'), text: z.string() }),
  z.object({ kind: z.literal('needs_kyc') }),
  z.object({
    kind: z.literal('needs_beneficiary'),
    beneficiaryType: z.enum(['bank_account', 'crypto_address']),
    /**
     * Optional targeted message, e.g. "No saved beneficiary called 'mum'."
     * when a recipientNickname resolved to zero saved beneficiaries.
     */
    note: z.string().optional(),
  }),
  // Emitted when a recipientNickname resolves to MORE THAN ONE of the user's
  // saved beneficiaries — the UI renders a pick-one list and re-sends the turn
  // with the chosen `beneficiaryId`.
  //
  // SECURITY (CLAUDE.md §3.1): `detail` is a HUMAN-SAFE masked string only
  // (bank: "<bank name> ••1234"; crypto: address head/tail ellipsis, the same
  // masking the proposal confirmation uses) — never a full account number or
  // address. `id` is the server-resolved beneficiaryId; the proposal/engine
  // re-validate ownership, type, cooling-off, and sanctions before any money
  // moves.
  z.object({
    kind: z.literal('choose_beneficiary'),
    beneficiaryType: z.enum(['bank_account', 'crypto_address']),
    /** The nickname the user said, echoed back for the picker copy. */
    nickname: z.string(),
    candidates: z
      .array(
        z.object({
          id: z.string().uuid(),
          label: z.string(),
          /** Human-safe masked destination summary (never the full value). */
          detail: z.string(),
        }),
      )
      .min(1),
  }),
  z.object({
    kind: z.literal('receive'),
    deposit: z.object({
      asset: z.string(),
      network: z.string(),
      address: z.string(),
      minAmount: z.string().optional(),
      etaText: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal('proposal'),
    txType: z.enum(['buy', 'sell', 'send', 'swap']),
    proposalId: z.string().uuid(),
    // Union so each txType renders the correct itemized breakdown component.
    confirmation: z.union([
      BuyProposalConfirmationSchema,
      SellProposalConfirmationSchema,
      SendProposalConfirmationSchema,
      SwapProposalConfirmationSchema,
    ]),
  }),
  // balance is `kind` + the snapshot fields, merged so the discriminant stays
  // a direct member (z.discriminatedUnion requires the literal in each branch).
  z.object({ kind: z.literal('balance') }).merge(BalanceSnapshotSchema),
  z.object({
    kind: z.literal('not_supported'),
    // check_balance is now a supported capability — no longer routed here.
    action: z.enum(['swap', 'buy_ticket', 'unknown']),
  }),
  // Emitted when the user requests a currency that is in the FiatCurrencySchema
  // supported set but has `enabled: false` in the catalog config (not yet live).
  // The web UI renders a "this currency isn't available yet" message.
  z.object({
    kind: z.literal('currency_not_live'),
    currency: FiatCurrencySchema,
    /**
     * The fiat codes the platform can settle TODAY (AssetRegistry enabled set),
     * so the client copy ("we currently settle in NGN and GHS") is driven by the
     * server's live catalog instead of a hardcoded constant. Optional for
     * backwards compatibility with persisted history rows that pre-date it.
     */
    liveCurrencies: z.array(FiatCurrencySchema).optional(),
  }),
  TransactionHistoryResponseSchema.extend({ kind: z.literal('transactions') }),
])
export type AgentTurnOutcome = z.infer<typeof AgentTurnOutcomeSchema>

// Full response envelope returned by POST /agent/chat.
export const WebChatResponseSchema = z.object({
  reply: z.object({ text: z.string() }),
  outcome: AgentTurnOutcomeSchema,
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
})
export type WebChatResponse = z.infer<typeof WebChatResponseSchema>

// ---------------------------------------------------------------------------
// Chat history (GET /chat/messages) — used to rehydrate the web thread on reload.
// One item per persisted turn: the user's text + the rendered agent outcome.
// `outcome` is nullable because a turn may have been persisted before its reply
// resolved (or pre-date outcome persistence) — the UI then shows only the user
// bubble. Reuses AgentTurnOutcomeSchema so the FE maps history exactly as it maps
// a live POST /chat/messages response.
// ---------------------------------------------------------------------------
export const ChatHistoryItemSchema = z.object({
  messageId: z.string().uuid(),
  userText: z.string(),
  outcome: AgentTurnOutcomeSchema.nullable(),
  createdAt: z.string().datetime(), // ISO string
})
export type ChatHistoryItem = z.infer<typeof ChatHistoryItemSchema>

// Paginated history response. `messages` are oldest→newest (render order).
// `nextCursor` is the messageId to pass as `?before=` to load the previous
// (older) page; null when the first turn has been reached.
export const ChatHistoryResponseSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  messages: z.array(ChatHistoryItemSchema),
  nextCursor: z.string().uuid().nullable(),
  hasMore: z.boolean(),
})
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>

// Query params for GET /chat/messages. `limit` arrives as a string from the URL,
// so coerce it; `before` is a messageId cursor for loading older turns.
export const ChatHistoryQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type ChatHistoryQuery = z.infer<typeof ChatHistoryQuerySchema>

// Voice-note chat response — the web POST /chat/voice envelope. Identical to the
// text response plus the transcript the STT produced (shown as the user's bubble).
export const VoiceChatResponseSchema = WebChatResponseSchema.extend({
  transcript: z.string(),
})
export type VoiceChatResponse = z.infer<typeof VoiceChatResponseSchema>

// Shared payment sub-object reused by execute and status responses.
const PaymentDetailsSchema = z.object({
  accountNumber: z.string(),
  bankName: z.string(),
  providerRef: z.string(),
  amount: z.string(),
  currency: z.string(),
})

// Authorize response — returned by POST /agent/proposals/:id/authorize.
// Contains the short-lived nonce the client passes to the execute endpoint.
export const AuthorizeProposalResponseSchema = z.object({
  directiveId: z.string().uuid(),
  nonce: z.string().min(1),
  expiresAt: z.string().datetime(), // ISO string
})
export type AuthorizeProposalResponse = z.infer<typeof AuthorizeProposalResponseSchema>

// Execute request — sent to POST /agent/proposals/:id/execute.
// PIN travels only over TLS to this endpoint; never logged or forwarded.
export const ExecuteProposalRequestSchema = z.object({
  directiveId: z.string().uuid(),
  nonce: z.string().min(1),
  pin: z.string().min(4).max(8),
  deviceFingerprint: z.string().optional(),
  idempotencyKey: z.string().uuid(),
})
export type ExecuteProposalRequest = z.infer<typeof ExecuteProposalRequestSchema>

// Execute response — returned once the engine has accepted and queued the transaction.
export const ExecuteProposalResponseSchema = z.object({
  transactionId: z.string().uuid(),
  status: z.enum(['settling', 'completed']),
  payment: PaymentDetailsSchema.optional(),
  payout: z.object({ providerRef: z.string() }).optional(),
  onChain: z.object({ providerRef: z.string() }).optional(),
  swap: z.object({ providerSwapId: z.string() }).optional(),
})
export type ExecuteProposalResponse = z.infer<typeof ExecuteProposalResponseSchema>

// Transaction status response — returned by GET /transactions/:id.
// Includes all detail fields available from the transaction's metadata so the
// FE can render a complete receipt without a second request.
export const TransactionStatusResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  /** 'in' for deposits/buys/receives; 'out' for sells/sends */
  direction: z.enum(['in', 'out']).optional(),
  receiptNumber: z.string().optional(),
  payment: PaymentDetailsSchema.optional(),
  asset: z.string().optional(),
  network: z.string().optional(),
  cryptoAmount: z.string().optional(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().optional(),
  /** On-chain transaction hash (deposits, sends) */
  txHash: z.string().optional(),
  /** Block number at which the tx was confirmed */
  blockNumber: z.number().int().nonnegative().optional(),
  /** Number of block confirmations */
  confirmations: z.number().int().nonnegative().optional(),
  /** Counterparty address or identifier (send destination, deposit sender) */
  counterparty: z.string().optional(),
  /** Network fee paid (formatted display string) */
  fees: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type TransactionStatusResponse = z.infer<typeof TransactionStatusResponseSchema>
