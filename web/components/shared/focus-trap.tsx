"use client"

import { useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import type { FocusTrapProps } from "@/types/components"

const FOCUSABLE =
  'a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])'

/**
 * Shared focus trap — wraps a modal region:
 *  - Focuses the first focusable descendant on mount.
 *  - Traps Tab / Shift+Tab within the wrapper (cycling).
 *  - No Esc-dismiss (caller controls close).
 *
 * Used by PIN modals on both mobile and desktop surfaces.
 */
export function FocusTrap({ ariaLabel, children, className }: FocusTrapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const first = wrap.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? wrap).focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !wrap) return
      const focusable = Array.from(
        wrap.querySelectorAll<HTMLElement>(FOCUSABLE)
      )
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault()
          lastEl.focus()
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }

    wrap.addEventListener("keydown", handleKeyDown)
    return () => wrap.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div
      ref={wrapRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={cn("absolute inset-0 z-[45]", className)}
      tabIndex={-1}
    >
      {children}
    </div>
  )
}
