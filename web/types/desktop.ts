/** Prop types for the desktop dashboard surface (`components/desktop/`). */

import type { ChatAction, DashboardPage, SearchResult } from "@/lib/schemas"

// ─── Phase 16 desktop components ─────────────────────────────────────────────

/**
 * Shared prop shape for full-page desktop views that expose a quick-action
 * entry-point into the chat rail. All three desktop pages
 * (OverviewPage / WalletPage / TicketsPage) satisfy this interface exactly.
 */
export interface PageWithQuickActionProps {
  onQuickAction: (action: ChatAction, label: string) => void
  className?: string
}

/** 16.1 */
export interface DashboardSidebarProps {
  active: DashboardPage
  onNavigate: (p: DashboardPage) => void
  className?: string
}

/** 16.2 */
export interface DashboardTopbarProps {
  onSearchSelect: (r: SearchResult) => void
  onQuickAction: (action: ChatAction, label: string) => void
  className?: string
}

/** 16.4 */
export interface ChatRailProps {
  store?: import("@/lib/store/chat-store").ChatStore
  className?: string
}
