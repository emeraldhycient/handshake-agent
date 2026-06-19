import { z } from "zod"

// Fixed status semantics (root CLAUDE.md §5). Drives StatusPill + activity rows.
export const StatusToneSchema = z.enum(["success", "warn", "info", "neutral"])
export type StatusTone = z.infer<typeof StatusToneSchema>
