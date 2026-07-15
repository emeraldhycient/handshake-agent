"use client"

import { cn } from "@/lib/utils"
import { useToastStore } from "@/lib/store/toast-store"
import type { ToastProps } from "@/types"

/**
 * Transient settings toast — the design's dark pill. Desktop pins bottom-center
 * of the viewport; mobile floats above the tab bar inside the settings surface.
 * Renders nothing when there is no message.
 */
export function Toast({ density = "desktop", className }: ToastProps) {
  const message = useToastStore((s) => s.message)
  if (!message) return null

  const isMobile = density === "mobile"
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none left-1/2 z-50 -translate-x-1/2 animate-hs-toast rounded-[12px] bg-foreground font-semibold text-white",
        isMobile
          ? "absolute bottom-24 max-w-[88%] px-[18px] py-[11px] text-center text-[12.5px] shadow-[0_12px_30px_rgb(14_36_28/0.32)]"
          : "fixed bottom-[26px] px-5 py-3 text-[13.5px] whitespace-nowrap shadow-[0_12px_30px_rgb(14_36_28/0.28)]",
        className
      )}
    >
      {message}
    </div>
  )
}
