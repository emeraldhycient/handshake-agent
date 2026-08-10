/** Prop types for the mobile shell surface (`components/mobile/`). */

// ─── Phase 15 mobile components ───────────────────────────────────────────────

/** 15.1 — presentational; no state */
export interface ChatHeaderProps {
  className?: string
}

/** 15.1 — bottom navigation tabbar */
export type MobileTabId = "chat" | "wallet" | "activity" | "settings"

export interface MobileTabbarProps {
  active: MobileTabId
  onSelect: (tab: MobileTabId) => void
  className?: string
}

/** 15.2 — wallet tab data + callbacks (placeholder until Task 15.2) */
export interface WalletTabProps {
  onQuickAction: (
    action: import("@/lib/schemas").ChatAction,
    label: string
  ) => void
}

/** 15.2 — activity tab */
export interface ActivityTabProps {
  className?: string
}

/** 15.3 — MobileShell accepts an optional injected store for tests */
export interface MobileShellProps {
  store?: import("@/lib/store/chat-store").ChatStore
}
