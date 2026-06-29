/**
 * Chat API client — calls POST /chat/messages to send a user message to the
 * live agent and receive a structured outcome.
 *
 * Parses the request body through the contracts Zod schema before sending,
 * and parses the response after (UX gate — server is the security gate per §3.3).
 * The axios instance's request interceptor sets Idempotency-Key automatically
 * on every non-GET request.
 */
import {
  ChatMessageRequestSchema,
  WebChatResponseSchema,
  AuthorizeProposalResponseSchema,
  ExecuteProposalRequestSchema,
  ExecuteProposalResponseSchema,
  TransactionStatusResponseSchema,
  ChatHistoryResponseSchema,
} from "@handshake-agent/contracts"
import type {
  ChatMessageRequest,
  WebChatResponse,
  AuthorizeProposalResponse,
  ExecuteProposalRequest,
  ExecuteProposalResponse,
  TransactionStatusResponse,
  ChatHistoryResponse,
} from "@handshake-agent/contracts"
import { api } from "./client"

export async function sendChatMessage(
  body: ChatMessageRequest
): Promise<WebChatResponse> {
  // Parse body through the schema (UX gate — server is the security gate per §3.3)
  const validated = ChatMessageRequestSchema.parse(body)
  const { data } = await api.post("/chat/messages", validated)
  return WebChatResponseSchema.parse(data)
}

/**
 * Authorize a proposal — returns a short-lived directiveId + nonce pair.
 * Called immediately when the user taps "Confirm with PIN".
 * The nonce is single-use and must never be logged.
 */
export async function authorizeProposal(
  proposalId: string
): Promise<AuthorizeProposalResponse> {
  const { data } = await api.post(`/chat/proposals/${proposalId}/authorize`)
  return AuthorizeProposalResponseSchema.parse(data)
}

/**
 * Execute a proposal — submits the PIN + directive credentials.
 * idempotencyKey must be generated fresh once per confirm attempt (caller's
 * responsibility) so retries re-use the same key and stay idempotent.
 *
 * PIN travels only over TLS; never log the body.
 */
export async function executeProposal(
  proposalId: string,
  body: ExecuteProposalRequest
): Promise<ExecuteProposalResponse> {
  const validated = ExecuteProposalRequestSchema.parse(body)
  const { data } = await api.post(
    `/chat/proposals/${proposalId}/execute`,
    validated
  )
  return ExecuteProposalResponseSchema.parse(data)
}

/**
 * Poll transaction status — used after execute returns status:"settling"
 * to drive the TanStack Query refetchInterval until status === "completed".
 */
export async function getTransaction(
  transactionId: string
): Promise<TransactionStatusResponse> {
  const { data } = await api.get(`/transactions/${transactionId}`)
  return TransactionStatusResponseSchema.parse(data)
}

/**
 * Fetch the authenticated user's conversation history (oldest→newest), used to
 * rehydrate the chat thread on reload. `before` is a messageId cursor for the
 * previous (older) page. Response is parsed through the contracts schema.
 */
export async function fetchChatHistory(params?: {
  before?: string
  limit?: number
}): Promise<ChatHistoryResponse> {
  const { data } = await api.get("/chat/messages", { params })
  return ChatHistoryResponseSchema.parse(data)
}
