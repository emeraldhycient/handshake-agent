import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Canonical STATUS PILL (design spec §5). Shape: inline-flex, gap-1.5,
// text-[10.5px] font-bold, px-2.5 py-0.5, fully rounded. Semantic variants map
// to the muted-surface + accent-text token pairs (s*/t*); brand/utility
// variants keep the existing API so screens don't break.
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-[10.5px] leading-none font-bold whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // Semantic status surfaces (§5 status→token map)
        success: "bg-sok text-tok [a]:hover:bg-sok/80",
        warn: "bg-swn text-twn [a]:hover:bg-swn/80",
        danger: "bg-sdn text-tdn [a]:hover:bg-sdn/80",
        info: "bg-sif text-tif [a]:hover:bg-sif/80",
        neutral: "bg-card2 text-ink2 [a]:hover:bg-card2/80",
        // Brand / utility variants (existing API)
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-sdn text-tdn [a]:hover:bg-sdn/80",
        outline:
          "border-border text-foreground [a]:hover:bg-hov [a]:hover:text-muted-foreground",
        ghost: "hover:bg-hov hover:text-muted-foreground dark:hover:bg-hov/50",
        link: "text-tif underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
