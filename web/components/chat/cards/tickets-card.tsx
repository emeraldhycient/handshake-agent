import { cn } from "@/lib/utils"
import { Money } from "@/components/shared/money"
import type { TicketsCardProps } from "@/types/components"
import type { TicketOption } from "@/lib/schemas"

/**
 * TicketsCard — chat message card for event ticket selection.
 * Mobile prototype: lines 256–280. Desktop prototype: lines 866–875.
 * Each option is a button; clicking calls onSelect(opt).
 * No hex literals. Banner uses from-primary gradient; accent stripe is a
 * repeating-linear-gradient defined inline (structural, not a theme colour).
 */
export function TicketsCard({
  eventMeta,
  eventName,
  options,
  density,
  onSelect,
  className,
}: TicketsCardProps) {
  const isMobile = density === "mobile"

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-[0_6px_18px_rgba(20,40,32,0.07)]"
          : "w-[92%] rounded-[16px]",
        className
      )}
    >
      {/* Event banner */}
      <div
        className={cn(
          "relative flex items-end bg-gradient-to-br from-primary to-[#2a6f55]",
          isMobile ? "h-24 px-4 pb-[13px]" : "h-[84px] px-[15px] pb-3"
        )}
      >
        {/* Diagonal accent stripe — structural graphic, not a theme colour */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(115deg, rgba(245,166,35,0.16) 0 12px, transparent 12px 26px)",
          }}
        />
        <div className="relative">
          <p
            className={cn(
              "font-semibold text-success-bright",
              isMobile ? "text-[12px]" : "text-[11.5px]"
            )}
          >
            {eventMeta}
          </p>
          <p
            className={cn(
              "font-extrabold tracking-[-0.01em] text-primary-foreground",
              isMobile ? "text-[19px]" : "text-[17px]"
            )}
          >
            {eventName}
          </p>
        </div>
      </div>

      {/* Option list */}
      <div
        className={cn(
          "flex flex-col",
          isMobile
            ? "gap-[9px] px-3.5 pt-2.5 pb-3.5"
            : "gap-2 px-[13px] pt-[9px] pb-[13px]"
        )}
      >
        {options.map((opt: TicketOption) => (
          <button
            key={opt.tier}
            type="button"
            onClick={() => onSelect(opt)}
            className={cn(
              "flex cursor-pointer items-center gap-3 border border-border bg-card-muted text-left font-[inherit]",
              isMobile
                ? "rounded-[13px] px-[13px] py-3"
                : "rounded-[12px] px-3 py-[11px]"
            )}
          >
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "font-bold text-foreground",
                  isMobile ? "text-[14.5px]" : "text-[14px]"
                )}
              >
                {opt.tier}
              </p>
              <p
                className={cn(
                  "mt-[1px] text-muted-foreground",
                  isMobile ? "text-[12.5px]" : "text-[12px]"
                )}
              >
                {opt.perk}
              </p>
            </div>
            <div className="text-right">
              <Money
                value={opt.price}
                as="p"
                className={cn(
                  "font-extrabold text-foreground",
                  isMobile ? "text-[15px]" : "text-[14.5px]"
                )}
              />
              <p
                className={cn(
                  "text-muted-foreground-subtle",
                  isMobile ? "text-[11px]" : "text-[10.5px]"
                )}
              >
                {opt.left}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
