import type { ActivityFilter } from "@/lib/activity/filter"

/** Activity filter pills, in display order. */
export const ACTIVITY_FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "tickets", label: "Tickets" },
]
