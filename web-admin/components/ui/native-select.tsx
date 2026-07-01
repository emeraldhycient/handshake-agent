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
/**
 * Chevron indicator (§5 select). A native `<select>` can't inherit
 * `currentColor` into a `background-image`, and CSS vars can't be interpolated
 * into a URL-encoded data-URI at build time, so the caret glyph is drawn with a
 * fixed `--ink3`-matching hue (`#8b948a`) inside the encoded SVG — the same
 * approach as the design source. This keeps the primitive a single `<select>`
 * so `className` and react-hook-form `register(...)` spread onto it unchanged.
 */
const CHEVRON_BG =
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2212%22%20height=%2212%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%3E%3Cpath%20d=%22m6%209%206%206%206-6%22%20stroke=%22%238b948a%22%20stroke-width=%222%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22/%3E%3C/svg%3E')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat"

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-[38px] w-full min-w-0 appearance-none rounded-[11px] border border-line bg-field py-1 pr-[30px] pl-3 text-sm font-semibold text-ink transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        CHEVRON_BG,
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
