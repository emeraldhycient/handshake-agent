import { z } from "zod"
import { StatusToneSchema } from "./common"

export const ActivityItemSchema = z.object({
  /** Transaction direction / category */
  dir: z.enum(["in", "out", "ticket"]),
  /** Emoji or icon string for the row */
  icon: z.string(),
  /** Hex colour for the icon background tint (data — applied via inline style) */
  tint: z.string(),
  /** Hex colour for the icon foreground / stroke (data — applied via inline style) */
  col: z.string(),
  title: z.string(),
  /** Secondary descriptor e.g. counterparty or network */
  sub: z.string(),
  /** Formatted amount string e.g. "+ 50 USDT" */
  amount: z.string(),
  /** Status label e.g. "Completed", "Pending" */
  status: z.string(),
  /** Semantic tone for the status pill — drives StatusPill's token classes */
  statusTone: StatusToneSchema,
})

export type ActivityItem = z.infer<typeof ActivityItemSchema>

export const ActivityGroupSchema = z.object({
  /** Date / period header e.g. "Today", "Yesterday" */
  group: z.string(),
  items: z.array(ActivityItemSchema),
})

export type ActivityGroup = z.infer<typeof ActivityGroupSchema>
