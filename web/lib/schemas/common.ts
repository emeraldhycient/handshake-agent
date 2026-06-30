import { z } from "zod"

// Fixed status semantics (root CLAUDE.md §5). Drives StatusPill + activity rows.
// `danger` is the terminal-failure tone (failed / refunded / reversed) — kept
// distinct from `warn` (in-flight: pending / settling) so a user can tell a
// failed money movement apart from one still processing (audit #24).
export const StatusToneSchema = z.enum([
  "success",
  "warn",
  "danger",
  "info",
  "neutral",
])
export type StatusTone = z.infer<typeof StatusToneSchema>
