import { z } from "zod";

// Admin Agent console DTOs (Phase 4 wave 2) — READ-ONLY surfaces for the embedded
// LangGraph agent's configuration and conversation/intent logs. The agent
// model id + enablement flag are tuned through /admin/settings (DB-admin layer,
// §7); the SYSTEM PROMPT is READ-ONLY (a preview string only — never editable,
// per the agent invariant §3.1/§6). The ANTHROPIC_API_KEY is NEVER surfaced here.
// Single source of truth shared by API + web-admin.

// ── Agent config view ────────────────────────────────────────────────────────
export const AgentConfigViewSchema = z.object({
  /** Resolved from the layered config (agent.modelId). */
  modelId: z.string(),
  /** Resolved from the layered config (agent.enabled). */
  enabled: z.boolean(),
  /**
   * A READ-ONLY preview of the system prompt. Surfaced for operator visibility;
   * it is NOT editable here and carries no secret (the API key never appears).
   */
  systemPromptPreview: z.string(),
});
export type AgentConfigView = z.infer<typeof AgentConfigViewSchema>;

// ── Conversation log list ────────────────────────────────────────────────────
export const ConversationLogItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().nullable(),
  contactId: z.string().nullable(),
  language: z.string(),
  status: z.string(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ConversationLogItem = z.infer<typeof ConversationLogItemSchema>;

export const ConversationLogListResponseSchema = z.object({
  items: z.array(ConversationLogItemSchema),
  nextCursor: z.string().nullable(),
});
export type ConversationLogListResponse = z.infer<
  typeof ConversationLogListResponseSchema
>;

// ── Conversation log detail (messages + intents + replies) ───────────────────
export const ConversationLogMessageSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  processingStatus: z.string(),
  receivedAt: z.string(),
  /**
   * The validated intent the NLU layer emitted for this message (1:1). Null when
   * the message has not been (or could not be) processed into an intent. The
   * intent is descriptive only — never an executable financial parameter (§3.1).
   */
  intent: z
    .object({
      action: z.string(),
      confidence: z.number().nullable(),
    })
    .nullable(),
});
export type ConversationLogMessage = z.infer<
  typeof ConversationLogMessageSchema
>;

export const ConversationLogReplySchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  status: z.string(),
  sentAt: z.string().nullable(),
});
export type ConversationLogReply = z.infer<typeof ConversationLogReplySchema>;

export const ConversationLogDetailSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().nullable(),
  contactId: z.string().nullable(),
  language: z.string(),
  status: z.string(),
  messages: z.array(ConversationLogMessageSchema),
  replies: z.array(ConversationLogReplySchema),
});
export type ConversationLogDetail = z.infer<typeof ConversationLogDetailSchema>;
