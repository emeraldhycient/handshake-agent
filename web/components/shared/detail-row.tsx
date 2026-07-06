import { cn } from "@/lib/utils"
import { CopyButton } from "./copy-button"
import { ExplorerLink } from "./explorer-link"
import type { DetailRowProps } from "@/types/transaction"

/** Label ↔ value row with optional explorer link and copy button. */
export function DetailRow({
  label,
  value,
  mono = false,
  copyValue,
  explorerHref,
}: DetailRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-[10px]">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "flex items-center text-right text-[12.5px] font-semibold tabular-nums",
          mono && "font-mono"
        )}
        translate="no"
      >
        {value}
        {explorerHref !== undefined && <ExplorerLink href={explorerHref} />}
        {copyValue !== undefined && (
          <CopyButton value={copyValue} label={label} />
        )}
      </span>
    </div>
  )
}
