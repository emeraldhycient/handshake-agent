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
 * Chevron indicator (§5 select). A native `<select>` can't inherit `currentColor`
 * into a `background-image`, and CSS vars can't be interpolated into a URL-encoded
 * data-URI, so the caret glyph is drawn with a fixed `--ink3`-matching hue
 * (`#8b948a`) inside the encoded SVG — the same approach as the design source.
 *
 * It is applied as an inline `style` (longhand `background-*` props), NOT as
 * arbitrary background className utilities. This is deliberate: tailwind-merge (via
 * `cn()`) cannot classify an arbitrary background-image data-URI utility, so packing
 * the chevron into the className silently DROPPED the primitive's `bg-field` fill
 * (and any caller override), rendering the control with a transparent background on
 * every page. (Note: don't write the bracketed arbitrary-utility syntax in this
 * comment either — Tailwind v4's source scanner would extract it as a real class.)
 * Keeping the chevron out of the merge lets `bg-field`/`bg-card` win cleanly, and
 * the control stays a single `<select>` so `className`, inline `style`, and
 * react-hook-form `register(...)` all spread onto it unchanged.
 */
const CHEVRON_STYLE: React.CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2212%22%20height=%2212%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%3E%3Cpath%20d=%22m6%209%206%206%206-6%22%20stroke=%22%238b948a%22%20stroke-width=%222%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22/%3E%3C/svg%3E\")",
  backgroundPosition: "right 10px center",
  backgroundSize: "12px",
  backgroundRepeat: "no-repeat",
}

function NativeSelect({
  className,
  style,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      style={{ ...CHEVRON_STYLE, ...style }}
      className={cn(
        "h-[38px] w-full min-w-0 appearance-none rounded-[11px] border border-line bg-field py-1 pr-[30px] pl-3 text-sm font-semibold text-ink transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
