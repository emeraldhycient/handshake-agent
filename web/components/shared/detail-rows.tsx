import { cn } from "@/lib/utils"
import type { DetailRowsProps } from "@/types/components"

/**
 * Renders a vertical list of label/value detail rows.
 * Pattern: prototype lines 180–185. No hex literals — token classes only.
 */
export function DetailRows({ rows, className }: DetailRowsProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {rows.map((row, i) => (
        <div
          key={`${row.label}-${i}`}
          className="flex items-center justify-between"
        >
          <span className="text-sm text-muted-foreground">{row.label}</span>
          <span className="text-sm font-semibold tabular-nums">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}
