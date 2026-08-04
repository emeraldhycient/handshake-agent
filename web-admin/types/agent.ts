/** Agent page + agent config page. */

import type { ReactNode } from "react"

// ─── Agent page (Phase 4) ──────────────────────────────────────────────────────────

export interface ConversationLogDetailProps {
  /** The selected conversation's id, or null when the drawer is closed. */
  conversationId: string | null
  onOpenChange: (open: boolean) => void
}

// ─── Agent config page (design §6.17 Agent config) ──────────────────────────────
// READ-ONLY oversight (§3.1): four cards, each self-contained (own query + four async
// branches) around a shared shell. The card data comes from `AgentConfigView` /
// `AgentInsightsView` in contracts — these are the component prop shapes only.

/** A card shell whose title is stable across every async branch. */
export interface AgentCardShellProps {
  title: string
  suffix?: string
  aside?: ReactNode
  children: ReactNode
}

/** One key/value row (Model & guardrails · Cost & usage) — a label + a mono value. */
export interface AgentKeyValueRowProps {
  label: string
  value: string
}
