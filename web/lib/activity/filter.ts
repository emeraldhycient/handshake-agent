import type { ActivityItem } from "@/lib/schemas"

/** Activity list filter — by transaction direction/category. */
export type ActivityFilter = "all" | "received" | "sent" | "tickets"

/** Whether an activity item belongs in the given filter. */
export function matchesFilter(
  item: ActivityItem,
  filter: ActivityFilter
): boolean {
  if (filter === "all") return true
  if (filter === "received") return item.dir === "in"
  if (filter === "sent") return item.dir === "out"
  if (filter === "tickets") return item.dir === "ticket"
  return true
}
