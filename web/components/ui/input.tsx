import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Field size matches the onboarding design's branded field (spec):
        // ~52px tall, 2px border, 15px radius, 17px text — one canonical size
        // for every input across the app (root §13.1). Weight is medium (the
        // design's fields use 600 on short values; medium reads cleaner across
        // long inputs). 17px also sidesteps iOS focus-zoom (≥16px).
        "h-[52px] w-full min-w-0 rounded-[15px] border-2 border-input bg-transparent px-4 text-[17px] font-medium shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
