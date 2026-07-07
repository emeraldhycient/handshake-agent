import { ACTIVITY_FILTERS } from "@/constants/activity"
import { cn } from "@/lib/utils"
import type { ActivityFiltersProps } from "@/types/activity"

/** Filter pills (All / Received / Sent / Tickets) for the activity list. */
export function ActivityFilters({ active, onChange }: ActivityFiltersProps) {
  return (
    <div className="flex gap-2">
      {ACTIVITY_FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
          className={cn(
            "cursor-pointer rounded-full border border-border px-4 py-2 text-[13px] font-semibold transition-colors",
            active === f.id
              ? "bg-foreground text-background"
              : "bg-card text-foreground hover:bg-muted"
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
