import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"
import type { StatusTone } from "@/lib/schemas"
import type { StatusPillProps } from "@/types/components"

/**
 * Status pill with CVA tone variants mapped to design tokens.
 * Text label always renders — color is never the sole signal (§13.8).
 * No hex literals. StatusTone imported from @/lib/schemas.
 */
const pillVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        success: "bg-success-muted text-success",
        warn: "bg-warn-muted text-warn",
        info: "bg-info-muted text-info",
        neutral: "bg-muted text-muted-foreground",
      } satisfies Record<StatusTone, string>,
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

export function StatusPill({ tone, children, className }: StatusPillProps) {
  return (
    <span className={cn(pillVariants({ tone }), className)}>{children}</span>
  )
}
