/**
 * Typed admin agent API clients (Phase 4) — READ-ONLY surfaces for the embedded
 * LangGraph agent's configuration and conversation/intent logs. The model id +
 * enablement flag are tuned through /admin/settings (DB-admin layer, §7); the
 * SYSTEM PROMPT is read-only (a preview string only — never editable, §3.1/§6),
 * and the ANTHROPIC_API_KEY is never surfaced. Each parses the response through
 * the contract schema.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AgentConfigViewSchema,
  AgentInsightsViewSchema,
  ConversationLogListResponseSchema,
  ConversationLogDetailSchema,
  type AgentConfigView,
  type AgentInsightsView,
  type ConversationLogListResponse,
  type ConversationLogDetail,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/agent/config — resolved model id, enablement, read-only prompt preview. */
export async function getAgentConfig(): Promise<AgentConfigView> {
  const res = await api.get("/admin/agent/config")
  return AgentConfigViewSchema.parse(res.data)
}

/**
 * GET /admin/agent/insights — the guardrail params, typed-tool registry, live
 * prompt version, and REAL rolling-24h usage counts (no token/cost — the schema
 * stores none). Backs the Agent console's four cards.
 */
export async function getAgentInsights(): Promise<AgentInsightsView> {
  const res = await api.get("/admin/agent/insights")
  return AgentInsightsViewSchema.parse(res.data)
}

/** GET /admin/agent/conversations — the conversation/intent log list. */
export async function listConversations(): Promise<ConversationLogListResponse> {
  const res = await api.get("/admin/agent/conversations")
  return ConversationLogListResponseSchema.parse(res.data)
}

/** GET /admin/agent/conversations/:id — one conversation's messages + replies. */
export async function getConversation(
  id: string
): Promise<ConversationLogDetail> {
  const res = await api.get(`/admin/agent/conversations/${id}`)
  return ConversationLogDetailSchema.parse(res.data)
}
