import { cn } from "@/lib/utils"
import type { MoneyProps } from "@/types/components"

/**
 * Renders a monetary value with tabular-nums for digit alignment.
 * No hex literals — purely token-based.
 */
export function Money({ value, className }: MoneyProps) {
  return <span className={cn("tabular-nums", className)}>{value}</span>
}
