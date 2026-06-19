/**
 * Centralized component prop types (§13.4 — no inline prop types).
 * All `XxxProps` interfaces for shared atoms live here and are imported
 * into the component files.
 */

import type { QuoteRow, StatusTone } from "@/lib/schemas"

// ─── Money (10.1) ─────────────────────────────────────────────────────────────

export interface MoneyProps {
  value: string
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
