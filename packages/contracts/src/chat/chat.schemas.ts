import { z } from 'zod'
import { BuyProposalConfirmationSchema } from '../tools/execute-buy.tool'
import { SellProposalConfirmationSchema } from '../tools/execute-sell.tool'
import { SendProposalConfirmationSchema } from '../tools/execute-send.tool'

// Request body sent from the web chat UI to POST /agent/chat.
export const ChatMessageRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  // Optional: pre-selected beneficiary so the agent can skip the lookup step.
  beneficiaryId: z.string().uuid().optional(),
})
export type ChatMessageRequest = z.infer<typeof ChatMessageRequestSchema>

// Discriminated union describing what the agent turn resolved to.
// The web UI branches on `kind` to decide which confirmation component to render.
export const AgentTurnOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clarification'), text: z.string() }),
  z.object({ kind: z.literal('needs_kyc') }),
  z.object({
    kind: z.literal('needs_beneficiary'),
    beneficiaryType: z.enum(['bank_account', 'crypto_address']),
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
    txType: z.enum(['buy', 'sell', 'send']),
    proposalId: z.string().uuid(),
    // Union so each txType renders the correct itemized breakdown component.
    confirmation: z.union([
      BuyProposalConfirmationSchema,
      SellProposalConfirmationSchema,
      SendProposalConfirmationSchema,
    ]),
  }),
  z.object({
    kind: z.literal('not_supported'),
    action: z.enum(['check_balance', 'swap', 'buy_ticket', 'unknown']),
  }),
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
})
export type ExecuteProposalResponse = z.infer<typeof ExecuteProposalResponseSchema>

// Transaction status response — returned by GET /transactions/:id/status.
export const TransactionStatusResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  receiptNumber: z.string().optional(),
  payment: PaymentDetailsSchema.optional(),
  asset: z.string().optional(),
  cryptoAmount: z.string().optional(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type TransactionStatusResponse = z.infer<typeof TransactionStatusResponseSchema>
