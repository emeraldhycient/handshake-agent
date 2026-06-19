import { cn } from "@/lib/utils"
import { Money } from "@/components/shared/money"
import { DetailRows } from "@/components/shared/detail-rows"
import type { ReceiptCardProps } from "@/types/components"

/**
 * ReceiptCard — chat message card confirming a completed transaction.
 * Mobile prototype: lines 283–308. Desktop prototype: lines 877–888.
 * Green success header on bg-success-muted; dashed divider above ref row.
 * Mobile shows a "Share receipt" affordance (desktop omits it — line 886 has
 * none). No hex literals. DetailRows and Money atoms reused.
 */
export function ReceiptCard({
  title,
  subtitle,
  amount,
  rows,
  ref: txRef,
  density,
  className,
}: ReceiptCardProps) {
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
      {/* Success header */}
      <div
        className={cn(
          "flex items-center gap-[11px] bg-success-muted",
          isMobile ? "px-4 py-[15px]" : "px-[15px] py-3.5"
        )}
      >
        {/* Check icon */}
        <div
          className={cn(
            "flex flex-none items-center justify-center rounded-full bg-success",
            isMobile ? "size-[34px]" : "size-8"
          )}
        >
          <svg
            width={isMobile ? 17 : 16}
            height={isMobile ? 17 : 16}
            viewBox="0 0 17 17"
            fill="none"
            aria-hidden
          >
            <path
              d="M3.5 9l3.2 3.4L13.5 5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-card"
            />
          </svg>
        </div>
        <div className="flex-1">
          <p
            className={cn(
              "font-bold text-success-foreground",
              isMobile ? "text-[15px]" : "text-[14.5px]"
            )}
          >
            {title}
          </p>
          <p
            className={cn(
              "text-success-foreground/80",
              isMobile ? "text-[12.5px]" : "text-[12px]"
            )}
          >
            {subtitle}
          </p>
        </div>
      </div>

      {/* Amount */}
      <Money
        value={amount}
        as="div"
        className={cn(
          "font-extrabold tracking-tight text-foreground",
          isMobile
            ? "px-4 pt-3.5 pb-1 text-[24px]"
            : "px-[15px] pt-[13px] pb-[3px] text-[22px]"
        )}
      />

      {/* Detail rows */}
      <div
        className={cn(
          isMobile ? "px-4 pt-1 pb-1.5" : "px-[15px] pt-[3px] pb-1.5"
        )}
      >
        <DetailRows rows={rows} className={isMobile ? "gap-2" : "gap-[7px]"} />
      </div>

      {/* Dashed divider + ref row */}
      <div
        className={cn(
          "mt-2 border-t border-dashed border-border",
          isMobile
            ? "flex items-center justify-between px-4 py-3"
            : "px-[15px] py-[11px]"
        )}
      >
        <span
          className="font-mono text-muted-foreground-subtle"
          style={{ fontSize: isMobile ? "11.5px" : "11px" }}
        >
          {txRef}
        </span>
        {isMobile && (
          <span className="cursor-pointer text-[13px] font-bold text-primary">
            Share receipt
          </span>
        )}
      </div>
    </div>
  )
}
