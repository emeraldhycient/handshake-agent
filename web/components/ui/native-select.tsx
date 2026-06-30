import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * NativeSelect — a styled native <select> matching the Input primitive.
 *
 * Native (not Radix) so it composes with react-hook-form's `register(...)`
 * exactly like Input, and is fully accessible/keyboard-native on mobile. Use
 * for simple option pickers (e.g. bank selection); reach for a Radix Select
 * only when rich custom rendering is required.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
