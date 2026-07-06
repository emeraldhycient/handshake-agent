import type { ActivityItem, ActivityGroup } from "@/lib/schemas"
import type { ActivityFilter } from "@/lib/activity/filter"

export interface ActivityRowProps {
  item: ActivityItem
  /** Index within its group — drives the top-border divider. */
  idx: number
  onSelect?: (id: string) => void
}

export interface ActivityFiltersProps {
  active: ActivityFilter
  onChange: (filter: ActivityFilter) => void
}

export interface ActivityGroupListProps {
  groups: ActivityGroup[]
  onSelect?: (id: string) => void
}
