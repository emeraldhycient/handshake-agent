/**
 * Prop types for the cross-cutting primitives in `components/shared/`
 * (§13.4 — no inline prop types), plus the shared `Density` sizing token.
 */

import type { QuoteRow, StatusTone } from "@/lib/schemas"

// ─── Density ──────────────────────────────────────────────────────────────────

/** Drives sizing/padding/radii variants across all chat message cards. */
export type Density = "mobile" | "desktop"

/** Shared "Load more" / "Show more" paginator button. */
export interface LoadMoreButtonProps {
  onClick: () => void
  isPending: boolean
  /** Active label, e.g. "Load more" or "Show more (10 of 12)". */
  label: string
  /** Shown (and disables the button) while pending. Default "Loading…". */
  pendingLabel?: string
  ariaLabel?: string
  /** Per-site shape (rounded-full pill vs full-width block). */
  className?: string
}

// ─── ActionButton (shared quick-action primitive) ────────────────────────────

/**
 * The one canonical Buy/Send/Receive/Swap quick-action button (§13.1). Used by
 * the overview hero, the wallet page header, and the mobile wallet tab so all
 * three render identically. `layout` switches between the inline pill (desktop)
 * and the stacked icon-tile (mobile wallet). The `label` is always the
 * accessible name; `icon` is decorative (callers pass an aria-hidden glyph).
 */
export interface ActionButtonProps {
  label: string
  /** Decorative glyph/icon node — rendered aria-hidden; the label names the button. */
  icon?: React.ReactNode
  variant?: "primary" | "secondary"
  /** "inline" → icon beside label (default). "stacked" → icon above label (mobile tile). */
  layout?: "inline" | "stacked"
  onClick: () => void
  className?: string
}

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
  /**
   * Optional absolute URL to the asset's logo image. When set, the icon renders
   * the logo (lazy, alt=sym); on a missing URL or load error it falls back to
   * the tinted text badge.
   */
  logoUrl?: string
  size?: "sm" | "md"
  className?: string
}

// ─── QrPlaceholder (10.5) ─────────────────────────────────────────────────────
export interface QrPlaceholderProps {
  size?: number
  className?: string
}

// ─── QrCode (real, scannable) ─────────────────────────────────────────────────

/** Real QR primitive (wraps qrcode.react); renders no external calls. */
export interface QrCodeProps {
  /** The URL/string the QR encodes. */
  value: string
  /** Accessible name for the QR image region. */
  label: string
  /** Pixel size of the square QR. Default 180. */
  size?: number
  className?: string
}

// ─── AvatarPlaceholder (10.6) ─────────────────────────────────────────────────
export interface AvatarPlaceholderProps {
  size?: number
  className?: string
}

// ─── BrandMark (logo) ─────────────────────────────────────────────────────────
export interface BrandMarkProps {
  /**
   * Centre treatment:
   *  - "default" — static dark square (the standing logo mark)
   *  - "spark"   — animated rotating sunburst (Claude-style), for thinking / splash
   */
  variant?: "default" | "spark"
  /** Outer tile size in px. Centre + corner radii scale proportionally. Default 42. */
  size?: number
  /**
   * Accessible name. When set, the mark is exposed as `role="img"` with this
   * label; when omitted the mark is decorative (`aria-hidden`) — it normally
   * sits beside the "Handshake Agent" wordmark.
   */
  ariaLabel?: string
  className?: string
}

// ─── Shared FocusTrap (Step 0 extraction) ────────────────────────────────────
export interface FocusTrapProps {
  ariaLabel: string
  children: React.ReactNode
  className?: string
}
