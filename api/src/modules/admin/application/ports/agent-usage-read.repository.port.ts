/**
 * DI token + port for the admin Agent-console USAGE read (Phase 6b READ
 * enrichment). READ-ONLY rolling-window counts over the conversation logs that
 * back the "Cost & usage (24h)" card.
 *
 * IMPORTANT (§3.6, no fabrication): the schema records NO token counts and NO
 * per-turn dollar cost, so this port exposes only what is actually measurable —
 * distinct conversations touched, inbound messages received, and outbound replies
 * sent within the window. The concrete Prisma adapter lives in
 * `admin/infrastructure`; the application layer depends only on this abstraction
 * (clean-arch §4.1, CLAUDE.md §3.2). Nothing here moves money (§3.1) — it only
 * counts existing rows.
 */
export const AGENT_USAGE_READ_REPOSITORY = Symbol(
  'AGENT_USAGE_READ_REPOSITORY',
);

/** Real rolling-window usage counts (never tokens/cost — the schema stores none). */
export interface AgentUsageWindowRecord {
  /** Distinct conversations with a message or reply in the window. */
  conversations: number;
  /** Inbound user messages received in the window. */
  inboundMessages: number;
  /** Outbound agent replies sent in the window. */
  outboundReplies: number;
}

export interface IAgentUsageReadRepository {
  /**
   * Counts agent usage since `since` (inclusive). Conversations are counted
   * distinctly across the messages + replies observed in the window; messages are
   * counted by `receivedAt`, replies by `createdAt`.
   */
  countUsageSince(since: Date): Promise<AgentUsageWindowRecord>;
}
