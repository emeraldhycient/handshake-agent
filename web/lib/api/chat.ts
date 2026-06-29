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
} from "@handshake-agent/contracts"
import type {
  ChatMessageRequest,
  WebChatResponse,
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
