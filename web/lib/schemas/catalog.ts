import { z } from "zod"

// ChatActionSchema is imported here so SearchResult can reference it without
// re-defining the enum — keeping the shapes DRY per §13.2.
import { ChatActionSchema } from "./chat"

// ─── Dashboard page enum ──────────────────────────────────────────────────────

export const DashboardPageSchema = z.enum([
  "overview",
  "wallet",
  "activity",
  "tickets",
  "settings",
])
export type DashboardPage = z.infer<typeof DashboardPageSchema>

// ─── Catalog shapes ───────────────────────────────────────────────────────────

export const EventListItemSchema = z.object({
  name: z.string(),
  /** Formatted metadata e.g. "Lagos · Dec 2025" */
  meta: z.string(),
  /** Price label e.g. "From ₦25,000" */
  price: z.string(),
})
export type EventListItem = z.infer<typeof EventListItemSchema>

export const AppNotificationSchema = z.object({
  /** Emoji or icon string */
  icon: z.string(),
  /** Hex tint for the icon container background */
  tint: z.string(),
  /** Hex colour for the icon foreground */
  col: z.string(),
  title: z.string(),
  /** Short body text */
  sub: z.string(),
  /** Relative time label e.g. "2 min ago" */
  time: z.string(),
})
export type AppNotification = z.infer<typeof AppNotificationSchema>

export const SearchResultSchema = z.object({
  /** Discriminates between global search result categories */
  kind: z.enum(["Action", "Page", "Transaction"]),
  title: z.string(),
  desc: z.string(),
  /** Emoji or icon string */
  icon: z.string(),
  /** Hex tint for icon background */
  tint: z.string(),
  /** Hex colour for icon foreground */
  col: z.string(),
  /** Present when kind === "Action" — the chat action to trigger */
  action: ChatActionSchema.optional(),
  /** CTA label override e.g. "Buy" */
  label: z.string().optional(),
  /** Present when kind === "Page" — the dashboard page to navigate to */
  page: DashboardPageSchema.optional(),
})
export type SearchResult = z.infer<typeof SearchResultSchema>
