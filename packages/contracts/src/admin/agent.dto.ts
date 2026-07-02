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

// ── Agent insights view (Phase 6b READ enrichment) ───────────────────────────
// READ-ONLY oversight for the Agent console's guardrails / tool-registry /
// prompt-version / 24h-usage cards. Nothing here moves money (§3.1) and no secret
// is ever surfaced. The values are computed on read from architectural invariants,
// the layered config, the real intent-action capability set, and live conversation
// counts — never fabricated. IMPORTANT: the schema stores NO token or dollar-cost
// data, so usage is real message/reply COUNTS (not tokens/cost) — we report what is
// actually measurable rather than inventing figures (§3.6).

/** One "Model & guardrails" key/value row — an architectural fact or config value. */
export const AgentGuardrailSchema = z.object({
  label: z.string(),
  value: z.string(),
});
export type AgentGuardrail = z.infer<typeof AgentGuardrailSchema>;

/** A tool's access class — `read` returns data, `write` only PROPOSES (§3.1). */
export const AgentToolKindSchema = z.enum(["read", "write"]);
export type AgentToolKind = z.infer<typeof AgentToolKindSchema>;

/** One typed-tool registry row derived from the real agent capability surface. */
export const AgentToolSchema = z.object({
  name: z.string(),
  kind: AgentToolKindSchema,
});
export type AgentTool = z.infer<typeof AgentToolSchema>;

/**
 * The live system-prompt version. There is NO prompt-version store (the prompt is
 * generated read-only from the live catalog, §3.1/§6), so exactly one row exists:
 * the current live prompt. `promptChars` is its length — a lightweight change
 * fingerprint an operator can watch — never the prompt body or any secret.
 */
export const AgentPromptVersionViewSchema = z.object({
  /** Semantic label for the live prompt (e.g. "live"). */
  label: z.string(),
  /** Lifecycle status — always "live" until a version store exists (Phase 7). */
  status: z.literal("live"),
  /** Character length of the current system prompt (a change fingerprint). */
  promptChars: z.number().int().nonnegative(),
});
export type AgentPromptVersionView = z.infer<
  typeof AgentPromptVersionViewSchema
>;

/**
 * Real rolling-24h usage counts from the conversation logs. The schema records no
 * token counts or per-turn cost, so these are the honest, measurable figures:
 * conversations touched, inbound messages received, and outbound replies sent in
 * the window. `windowHours` documents the window (24) for the card label.
 */
export const AgentUsage24hSchema = z.object({
  /** Distinct conversations with activity in the last 24h. */
  conversations: z.number().int().nonnegative(),
  /** Inbound user messages received in the last 24h. */
  inboundMessages: z.number().int().nonnegative(),
  /** Outbound agent replies sent in the last 24h. */
  outboundReplies: z.number().int().nonnegative(),
  /** The rolling window in hours (24) — drives the card's "(24h)" label. */
  windowHours: z.number().int().positive(),
});
export type AgentUsage24h = z.infer<typeof AgentUsage24hSchema>;

export const AgentInsightsViewSchema = z.object({
  guardrails: z.array(AgentGuardrailSchema),
  tools: z.array(AgentToolSchema),
  promptVersion: AgentPromptVersionViewSchema,
  usage24h: AgentUsage24hSchema,
});
export type AgentInsightsView = z.infer<typeof AgentInsightsViewSchema>;
