import { cn } from "@/lib/utils"
import { Money } from "@/components/shared/money"
import { DetailRows } from "@/components/shared/detail-rows"
import type { QuoteCardProps } from "@/types/components"

/**
 * QuoteCard — chat message card for a crypto buy/send/swap quote.
 * Mobile prototype: lines 164–197. Desktop prototype: lines 823–838.
 * density prop controls sizing/padding/radii only — both variants render the same data.
 * No hex literals. No data fetching. Pure presentational.
 */
export function QuoteCard({
  receiveAmt,
  receiveSub,
  rows,
  totalLabel,
  totalValue,
  density,
  onConfirm,
  className,
}: QuoteCardProps) {
  const isMobile = density === "mobile"

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-[0_6px_18px_rgba(20,40,32,0.07)]"
          : "w-[92%] rounded-[16px] shadow-[0_4px_14px_rgba(20,40,32,0.06)]",
        className
      )}
    >
      {/* Header: eyebrow + lock badge */}
      <div
        className={cn(
          "flex items-center justify-between",
          isMobile ? "px-4 pt-3.5" : "px-[15px] pt-[13px]"
        )}
      >
        <span
          className={cn(
            "font-bold tracking-widest text-muted-foreground-subtle uppercase",
            isMobile ? "text-[12px]" : "text-[11px]"
          )}
        >
          Quote
        </span>
        <span
          className={cn(
            "rounded-full bg-warn-muted font-semibold text-warn",
            isMobile
              ? "px-[9px] py-[3px] text-[11.5px]"
              : "px-2 py-[2px] text-[11px]"
          )}
        >
          Locked 0:58
        </span>
      </div>

      {/* Receive amount */}
      <div
        className={cn(
          isMobile ? "px-4 pt-2 pb-3.5" : "px-[15px] pt-[7px] pb-0"
        )}
      >
        <Money
          value={receiveAmt}
          as="div"
          className={cn(
            "font-extrabold tracking-tight text-foreground",
            isMobile ? "text-[30px]" : "text-[26px]"
          )}
        />
        <p
          className={cn(
            "mt-[1px] text-muted-foreground",
            isMobile ? "text-[13px]" : "text-[12px]"
          )}
        >
          {receiveSub}
        </p>
      </div>

      {/* Divider */}
      <div className={cn("h-px bg-border", isMobile ? "mx-4" : "mx-[15px]")} />

      {/* Detail rows */}
      <div
        className={cn(
          isMobile ? "px-4 pt-3 pb-1" : "px-[15px] pt-[11px] pb-[3px]"
        )}
      >
        <DetailRows rows={rows} className={isMobile ? "gap-[9px]" : "gap-2"} />
      </div>

      {/* Divider */}
      <div
        className={cn(
          "h-px bg-border",
          isMobile ? "mx-4 mt-3" : "mx-[15px] mt-[11px]"
        )}
      />

      {/* Total row */}
      <div
        className={cn(
          "flex items-baseline justify-between",
          isMobile ? "px-4 py-[13px]" : "px-[15px] py-3"
        )}
      >
        <span
          className={cn(
            "font-bold text-foreground",
            isMobile ? "text-[14px]" : "text-[13px]"
          )}
        >
          {totalLabel}
        </span>
        <Money
          value={totalValue}
          className={cn(
            "font-extrabold text-foreground",
            isMobile ? "text-[16px]" : "text-[15px]"
          )}
        />
      </div>

      {/* CTA */}
      <div className={cn(isMobile ? "px-4 pb-4" : "px-[15px] pb-[15px]")}>
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            "w-full cursor-pointer border-none bg-accent font-bold text-accent-foreground",
            "shadow-[0_3px_10px_rgba(232,150,26,0.32)]",
            isMobile
              ? "rounded-[14px] py-3.5 text-[15px]"
              : "rounded-[12px] py-3 text-[14px]"
          )}
        >
          Review &amp; confirm
        </button>
        {isMobile && (
          <p className="mt-[9px] text-center text-[11.5px] text-muted-foreground-subtle">
            Rate locked 60s · No hidden fees
          </p>
        )}
      </div>
    </div>
  )
}
