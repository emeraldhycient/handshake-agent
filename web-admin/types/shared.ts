/** Shared, feature-agnostic component prop types (page header, pager, KPI card, CSV export). */

import type { ReactNode } from "react"

/** Shared admin page header — title + optional subtitle + right-aligned actions. */
export interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

/** Keyset cursor pager (Prev / Next + page number). */
export interface CursorPaginatorProps {
  pageIndex: number
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  /** Left-aligned status text; defaults to `Page {pageIndex}`. */
  leftLabel?: ReactNode
  /** When true, both buttons are disabled (e.g. a page fetch is in flight). */
  busy?: boolean
}

/** One `{ value, label }` option for a FilterSelect-style control. */
export interface FilterOption {
  value: string
  label: string
}

/** A header + rows payload ready to serialize to CSV. */
export interface CsvExportData {
  headers: readonly string[]
  rows: (string | number)[][]
}

/**
 * ExportCsvButton props (go-readiness #7 per-area export). `build` runs at click
 * time so the CSV is serialized only on demand. `onDownload` is injectable for
 * tests; it defaults to the real browser download in `lib/csv`.
 */
export interface ExportCsvButtonProps {
  filename: string
  build: () => CsvExportData
  label?: string
  disabled?: boolean
  onDownload?: (filename: string, csv: string) => void
}

// ─── Compliance console (Phase 3) ────────────────────────────────────────────────

/**
 * The `Badge` component's `variant` union, mirrored here so `constants/` + tab
 * components can type their variant maps without importing the component (layering-safe).
 */
export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "neutral"

// ─── Shared UI primitives (design §5) ──────────────────────────────────────────────

/** A KpiCard delta chip's tone → the token pair driving its surface + text. */
export type KpiDeltaTone = "success" | "warn"

/**
 * KpiCard (design §5 "KPI stat card") — a labelled stat tile. `hero` renders the
 * dark-green brand gradient (white ink, amber-on-deep delta chip); a normal tile uses
 * the `--card` surface with a success/warn delta chip.
 */
export interface KpiCardProps {
  /** The stat label (12px/600). */
  label: string
  /** The big value (26px/800, tabular). */
  value: string
  /** Optional delta chip text (e.g. "+12.4%"). */
  delta?: string
  /** Optional muted note after the delta (e.g. "vs prior"). */
  deltaNote?: string
  /** Tile 0 → dark-green hero (white ink, amber delta chip). */
  hero?: boolean
  /** Non-hero tiles: use the warn (amber) delta pair instead of success. */
  tone?: KpiDeltaTone
}
