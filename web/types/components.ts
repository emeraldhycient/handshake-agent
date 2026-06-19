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
