"use client"

/**
 * StepUpModal — flow modal step-up TOTP (design template line 1182). A dark-green
 * gradient lock icon, six digit boxes (the next-to-fill box gets the amber active
 * border), an on-screen keypad, and a Cancel affordance. Fires `onComplete(code)` once
 * the sixth digit is entered. Presentation only — the caller verifies the code against
 * the real step-up endpoint and retries its mutation.
 *
 * Built on the shared Dialog primitive (focus-trap + Esc close). Physical keyboard
 * digits/backspace also drive the boxes so it stays keyboard-accessible.
 */
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import type { StepUpModalProps } from "@/types/components"

const BOXES = [0, 1, 2, 3, 4, 5] as const
/** Keypad layout: 1-9, a blank spacer, 0, delete (design `totpKeys`, logic.js 400). */
const KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "",
  "0",
  "del",
] as const

export function StepUpModal({
  open,
  onOpenChange,
  title,
  onComplete,
}: StepUpModalProps) {
  const [code, setCode] = useState("")

  // Clear the entered code on every close path (Cancel / Esc / scrim / caller) so a
  // re-open always starts empty — no reset-in-effect needed.
  function handleOpenChange(next: boolean) {
    if (!next) setCode("")
    onOpenChange(next)
  }

  function press(key: string) {
    setCode((prev) => {
      if (key === "del") return prev.slice(0, -1)
      if (prev.length >= 6) return prev
      const next = prev + key
      if (next.length === 6) {
        // Defer so the sixth box renders before the caller advances.
        setTimeout(() => onComplete(next), 0)
      }
      return next
    })
  }

  // Physical-keyboard support (digits + backspace) when the modal is open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        press(e.key)
      } else if (e.key === "Backspace") {
        e.preventDefault()
        press("del")
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
    // press is stable enough for this effect; re-bind only on open toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[440px] max-w-[94vw] gap-0 p-[26px] text-center"
      >
        <span className="mx-auto mb-3.5 flex size-[46px] items-center justify-center rounded-[14px] bg-[linear-gradient(150deg,var(--brand-green),var(--brand-green-deep))]">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M7 11V8a5 5 0 0 1 10 0v3"
              stroke="#f5a623"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <rect x="5" y="11" width="14" height="9" rx="2.4" fill="#f5a623" />
          </svg>
        </span>
        <DialogTitle className="text-[18px]">
          Step-up authentication
        </DialogTitle>
        <DialogDescription className="mx-auto mt-1.5 mb-[18px] max-w-[340px] text-[13px] leading-normal text-ink2">
          Re-enter your 6-digit authenticator code to authorize <b>{title}</b>.
        </DialogDescription>

        <div className="mb-2 flex justify-center gap-2">
          {BOXES.map((i) => {
            const active = i === code.length
            return (
              <div
                key={i}
                className={cn(
                  "flex h-[52px] w-11 items-center justify-center rounded-[11px] border-[1.5px] bg-field text-[22px] font-extrabold tabular-nums",
                  active ? "border-brand-amber" : "border-line"
                )}
              >
                {code[i] ?? ""}
              </div>
            )
          })}
        </div>

        <div className="mx-auto mt-3.5 flex max-w-[280px] flex-wrap justify-center gap-2">
          {KEYS.map((key, i) =>
            key === "" ? (
              <span key={`spacer-${i}`} className="h-11 w-[76px]" aria-hidden />
            ) : (
              <button
                key={key}
                type="button"
                onClick={() => press(key)}
                aria-label={key === "del" ? "Delete" : key}
                className="flex h-11 w-[76px] items-center justify-center rounded-[11px] border border-line bg-card text-[17px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {key === "del" ? "⌫" : key}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          className="mx-auto mt-4 text-[13px] font-semibold text-ink3 transition-colors hover:text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  )
}
