import { cn } from "@/lib/utils"
import type { MoneyProps } from "@/types"

/**
 * Renders a monetary value with tabular-nums for digit alignment.
 * `as` controls the rendered element (default "span") for layout flexibility.
 * No hex literals — purely token-based.
 */
export function Money({ value, as, className }: MoneyProps) {
  const Tag = as ?? "span"
  return (
    <Tag className={cn("tabular-nums", className)} translate="no">
      {value}
    </Tag>
  )
}
