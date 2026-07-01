import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Buttons per design spec §5. Base radius 11px; standard height 36–38px.
// `default` is the primary-dark CTA (btn-dark); `primary`/`amber` is the
// reserved engine-execute amber CTA; `green` is the brand-green CTA.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[11px] border border-transparent bg-clip-padding text-sm font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary-dark CTA (§5 "Add entry" / "Invite admin" / bulk bar)
        default:
          "bg-btn-dark font-extrabold text-white hover:bg-btn-dark/90 aria-expanded:bg-btn-dark",
        // Reserved amber "engine-execute" CTA (§5)
        primary:
          "bg-brand-amber font-extrabold text-[--ink-on-amber] shadow-cta hover:bg-brand-amber/90",
        amber:
          "bg-brand-amber font-extrabold text-[--ink-on-amber] shadow-cta hover:bg-brand-amber/90",
        // Brand-green CTA ("Resolve via engine")
        green:
          "bg-brand-green font-extrabold text-white hover:bg-brand-green/90",
        outline:
          "border-line bg-card text-ink hover:bg-hov aria-expanded:bg-hov dark:bg-card dark:hover:bg-hov",
        secondary:
          "border border-line bg-card text-ink hover:bg-hov aria-expanded:bg-hov",
        ghost:
          "text-ink hover:bg-hov aria-expanded:bg-hov dark:hover:bg-hov/60",
        // Danger ghost (§5): danger border + text, danger-surface hover
        destructive:
          "border border-sdn text-tdn hover:bg-sdn focus-visible:border-tdn/40 focus-visible:ring-destructive/20",
        link: "text-tif underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-[8px] px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-[10px] px-3 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-[38px] gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9 rounded-[11px]",
        "icon-xs":
          "size-6 rounded-[8px] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[10px] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10 rounded-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
