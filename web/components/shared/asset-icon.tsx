import { cn } from "@/lib/utils"
import type { AssetIconProps } from "@/types/components"

/**
 * Tinted chip showing an asset symbol.
 * The `tint` prop is applied via inline style (the one approved data exception —
 * asset tints are dynamic data values, not theme colors; §3 of the plan).
 * No hex in className. Symbol text uses token class `text-foreground`.
 */
export function AssetIcon({
  sym,
  tint,
  size = "md",
  className,
}: AssetIconProps) {
  return (
    <div
      data-testid="asset-icon"
      className={cn(
        "flex items-center justify-center rounded-full text-sm font-bold text-foreground",
        size === "sm" ? "size-8" : "size-[38px]",
        className
      )}
      style={{ backgroundColor: tint }}
    >
      {sym}
    </div>
  )
}
