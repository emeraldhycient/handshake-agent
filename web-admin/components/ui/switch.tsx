"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Soft toggle (§5): fully-rounded track, brand-green when on, card2
        // surface when off, white knob in both states/themes.
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[26px] data-[size=default]:w-[46px] data-[size=sm]:h-[18px] data-[size=sm]:w-[32px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-brand-green data-unchecked:bg-card2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] ring-0 transition-transform group-data-[size=default]/switch:size-5 group-data-[size=default]/switch:translate-x-[3px] group-data-[size=sm]/switch:size-3.5 group-data-[size=sm]/switch:translate-x-[2px] group-data-[size=default]/switch:data-checked:translate-x-[23px] group-data-[size=sm]/switch:data-checked:translate-x-[16px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
