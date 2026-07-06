import type { ChatAction, EventListItem } from "@/lib/schemas"

export interface EventRowProps {
  event: EventListItem
  /** Index within the list — drives the top-border divider. */
  idx: number
  onQuickAction: (action: ChatAction, label: string) => void
}

export interface BrowseEventsProps {
  events: EventListItem[]
  isLoading: boolean
  isError: boolean
  onQuickAction: (action: ChatAction, label: string) => void
}
