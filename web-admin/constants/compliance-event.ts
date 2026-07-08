import { ComplianceDispositionRequestSchema } from "@handshake-agent/contracts"

/** The disposition statuses — the contract's `status` enum (approved/blocked/dismissed/under_review). */
export const DISPOSITIONS =
  ComplianceDispositionRequestSchema.shape.status.options

/** The comment textarea styling. */
export const COMMENT_TEXTAREA_CLASS =
  "min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
