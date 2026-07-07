import { ComplianceReportDraftRequestSchema } from "@handshake-agent/contracts"

/** The report types a draft can carry (sar / str) — sourced from the contract enum. */
export const REPORT_TYPES = ComplianceReportDraftRequestSchema.shape.reportType.options

/**
 * Shared class for the monospace JSON/id textareas in the draft form. A long
 * literal reused by both the "Related event ids" and "Content (JSON)" fields —
 * named so the two stay identical.
 */
export const MONO_TEXTAREA_CLASS =
  "min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
