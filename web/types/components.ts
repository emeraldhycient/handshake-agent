/**
 * Centralized component prop types (§13.4 — no inline prop types).
 * All `XxxProps` interfaces for shared atoms live here and are imported
 * into the component files.
 */

import type {
  QuoteRow,
  StatusTone,
  QuoteView,
  BalanceView,
  DepositView,
  TicketsView,
  TicketOption,
  ReceiptView,
  ChatMessage,
  ChatAction,
  ConfirmPayload,
} from "@/lib/schemas"

// ─── Density ──────────────────────────────────────────────────────────────────

/** Drives sizing/padding/radii variants across all chat message cards. */
export type Density = "mobile" | "desktop"

// ─── Money (10.1) ─────────────────────────────────────────────────────────────

export interface MoneyProps {
  value: string
  /** Rendered HTML element — defaults to "span" for inline usage */
  as?: "span" | "div" | "p"
  className?: string
}

// ─── DetailRows (10.2) ────────────────────────────────────────────────────────

export interface DetailRowsProps {
  rows: QuoteRow[]
  className?: string
}

// ─── StatusPill (10.3) ────────────────────────────────────────────────────────

export interface StatusPillProps {
  tone: StatusTone
  children: React.ReactNode
  className?: string
}

// ─── AssetIcon (10.4) ─────────────────────────────────────────────────────────

export interface AssetIconProps {
  sym: string
  /** Data tint color — applied via inline style (the one approved hex exception) */
  tint: string
  size?: "sm" | "md"
  className?: string
}

// ─── QrPlaceholder (10.5) ─────────────────────────────────────────────────────

export interface QrPlaceholderProps {
  size?: number
  className?: string
}

// ─── Chat message cards (Phase 11) ────────────────────────────────────────────

/** 11.1 */
export type QuoteCardProps = QuoteView & {
  density: Density
  onConfirm: () => void
  className?: string
}

/** 11.2 */
export type BalanceCardProps = BalanceView & {
  density: Density
  className?: string
}

/** 11.3 */
export type ReceiveCardProps = DepositView & {
  density: Density
  onCopy?: () => void
  className?: string
}

/** 11.4 */
export type TicketsCardProps = TicketsView & {
  density: Density
  onSelect: (opt: TicketOption) => void
  className?: string
}

/** 11.5 */
export type ReceiptCardProps = ReceiptView & {
  density: Density
  onShare?: () => void
  className?: string
}

// ─── Phase 12 chat thread components ──────────────────────────────────────────

/** 12.2 */
export interface ChatMessageViewProps {
  message: ChatMessage
  density: Density
  onConfirm: (m: ChatMessage) => void
  onSelectTicket: (opt: TicketOption) => void
}

/** 12.3 */
export interface ChatComposerProps {
  chips: ChatAction[]
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onChip: (a: ChatAction) => void
  density: Density
}

/** 12.4 */
export interface ChatThreadProps {
  messages: ChatMessage[]
  typing: boolean
  density: Density
  onConfirm: (m: ChatMessage) => void
  onSelectTicket: (opt: TicketOption) => void
}

// ─── Phase 13 overlay components ──────────────────────────────────────────────

/** 13.1 */
export interface ConfirmSheetProps {
  open: boolean
  payload: ConfirmPayload | null
  density: Density
  onConfirm: () => void
  onCancel: () => void
}

/** 13.2 */
export interface PinPadProps {
  open: boolean
  /** Number of digits entered so far (0–4). Controls filled dot count. */
  pinLength: number
  density: Density
  onDigit: (d: string) => void
  onBack: () => void
  onFaceId: () => void
  onCancel: () => void
}

/** 13.3 */
export interface SuccessOverlayProps {
  open: boolean
  text: string
}

// ─── Phase 14 onboarding ──────────────────────────────────────────────────────

/** 14.1 — presentational; no router dependency */
export interface KycSummaryProps {
  onFinish: () => void
}

/** 14.2 — single verification row inside KycSummary */
export interface VerificationRowProps {
  /**
   * Left-slot override. When provided, renders `iconNode` directly instead of
   * the default icon-box wrapper. Used for the selfie circular thumbnail.
   */
  iconNode?: React.ReactNode
  /** Icon element rendered inside the default square icon-box (ignored when `iconNode` is set). */
  icon?: React.ReactNode
  label: string
  value: string
  /** Apply font-mono to the value (masked numbers). */
  valueMono?: boolean
  pillLabel: string
}

// ─── Shared FocusTrap (Step 0 extraction) ────────────────────────────────────

export interface FocusTrapProps {
  ariaLabel: string
  children: React.ReactNode
  className?: string
}

// ─── Phase 15 mobile components ───────────────────────────────────────────────

/** 15.1 — presentational; no state */
export interface ChatHeaderProps {
  className?: string
}

/** 15.1 — bottom navigation tabbar */
export type MobileTabId = "chat" | "wallet" | "activity"
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
