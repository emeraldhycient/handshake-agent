import { cn } from "@/lib/utils"
import { Money } from "@/components/shared/money"
import { AssetIcon } from "@/components/shared/asset-icon"
import type { BalanceCardProps } from "@/types/components"

/**
 * BalanceCard — chat message card showing the user's portfolio snapshot.
 * Mobile prototype: lines 200–219. Desktop prototype: lines 840–849.
 * Dark gradient background; asset tints applied via inline style (data exception).
 * No hex literals on theme surfaces or text.
 */
export function BalanceCard({
  total,
  assets,
  density,
  className,
}: BalanceCardProps) {
  const isMobile = density === "mobile"

  return (
    <div
      className={cn(
        "overflow-hidden bg-gradient-to-b from-primary to-primary-deep text-primary-foreground",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-card-lg"
          : "w-[92%] rounded-[16px]",
        className
      )}
    >
      {/* Header: label + total */}
      <div
        className={cn(
          isMobile ? "px-[18px] pt-4 pb-3.5" : "px-4 pt-[15px] pb-3"
        )}
      >
        <p
          className={cn(
            "font-semibold tracking-[0.04em] uppercase opacity-70",
            isMobile ? "text-[12.5px]" : "text-[12px]"
          )}
        >
          Total balance
        </p>
        <Money
          value={total}
          as="div"
          className={cn(
            "mt-[3px] font-extrabold tracking-tight",
            isMobile ? "text-[32px]" : "text-[28px]"
          )}
        />
      </div>

      {/* Asset list */}
      <div className="bg-white/[0.04] px-2 pt-1.5 pb-2">
        {assets.map((asset) => (
          <div
            key={asset.sym}
            className={cn(
              "flex items-center",
              isMobile
                ? "gap-3 px-[11px] py-2.5"
                : "gap-[11px] px-[10px] py-[9px]"
            )}
          >
            <AssetIcon
              sym={asset.sym}
              tint={asset.tint}
              size={isMobile ? "md" : "sm"}
              className={cn(
                "flex-none rounded-[10px] text-[13px] font-extrabold",
                isMobile ? "size-[34px]" : "size-8"
              )}
            />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "font-semibold",
                  isMobile ? "text-[14px]" : "text-[13.5px]"
                )}
              >
                {asset.name}
              </p>
              <Money
                value={asset.amount}
                as="p"
                className={cn(
                  "opacity-60",
                  isMobile ? "text-[12.5px]" : "text-[12px]"
                )}
              />
            </div>
            <Money
              value={asset.value}
              className={cn(
                "text-right font-bold",
                isMobile ? "text-[14px]" : "text-[13.5px]"
              )}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
