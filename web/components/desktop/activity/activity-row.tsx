import { Money } from "@/components/shared/money"
import { StatusPill } from "@/components/shared/status-pill"
import { cn } from "@/lib/utils"
import type { ActivityRowProps } from "@/types/activity"

/** One clickable activity row — opens the transaction-detail modal on select. */
export function ActivityRow({ item, idx, onSelect }: ActivityRowProps) {
  return (
    <button
      type="button"
      data-tx-id={item.id}
      aria-label={`View details for ${item.title}`}
      onClick={() => onSelect?.(item.id)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-[13px] px-[18px] py-[14px] text-left",
        "transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
        idx > 0 && "border-t border-border"
      )}
    >
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-[17px] font-bold"
        style={{ backgroundColor: item.tint, color: item.col }}
        aria-hidden="true"
      >
        {item.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-bold text-foreground">{item.title}</p>
        <p className="text-[12.5px] text-muted-foreground tabular-nums">
          {item.sub}
        </p>
      </div>
      <div className="text-right">
        <Money
          value={item.amount}
          as="p"
          className="text-[14.5px] font-bold text-foreground"
        />
        <StatusPill tone={item.statusTone} className="mt-[3px] text-[10.5px]">
          {item.status}
        </StatusPill>
      </div>
    </button>
  )
}
