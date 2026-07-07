import { ActivityRow } from "./activity-row"
import type { ActivityGroupListProps } from "@/types/activity"

/** Renders activity items grouped by period, each group a bordered card of rows. */
export function ActivityGroupList({
  groups,
  onSelect,
}: ActivityGroupListProps) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.group}>
          <p className="mb-[9px] ml-0.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
            {g.group}
          </p>
          <div className="overflow-hidden rounded-[16px] border border-border bg-card">
            {g.items.map((item, idx) => (
              <ActivityRow
                key={item.id}
                item={item}
                idx={idx}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
