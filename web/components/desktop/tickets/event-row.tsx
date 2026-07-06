import { cn } from "@/lib/utils"
import type { EventRowProps } from "@/types/tickets"

/** One browsable event row — thumbnail, info, price, and a "Get ticket" CTA. */
export function EventRow({ event, idx, onQuickAction }: EventRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-[14px] px-[18px] py-[15px]",
        idx > 0 && "border-t border-border"
      )}
    >
      {/* Event thumbnail — gradient placeholder */}
      <div className="h-11 w-11 flex-none rounded-[11px] bg-gradient-to-br from-primary to-primary-deep" />
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-bold text-foreground">{event.name}</p>
        <p className="text-[12.5px] text-muted-foreground">{event.meta}</p>
      </div>
      <p className="text-[13px] text-muted-foreground tabular-nums">
        {event.price}
      </p>
      <button
        type="button"
        aria-label="Get ticket"
        onClick={() =>
          onQuickAction("ticket", `Get me a ticket to ${event.name}`)
        }
        className="flex-none cursor-pointer rounded-[11px] bg-accent px-4 py-[9px] text-[13px] font-bold text-accent-foreground hover:opacity-90"
      >
        Get ticket
      </button>
    </div>
  )
}
