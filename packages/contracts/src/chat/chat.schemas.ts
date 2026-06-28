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
