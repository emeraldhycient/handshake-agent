"use client"

import { Button } from "@/components/ui/button"
import type { KeypadProps } from "@/types"

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * The 3×4 grid order from the mockup: `1`–`9`, a blank spacer, `0`, then
 * backspace. `null` renders a non-interactive spacer cell so `0`/`⌫` line up
 * under `7`/`8`/`9`.
 */
const KEYPAD_LAYOUT: readonly (string | null)[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  null,
  "0",
  "backspace",
]

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The mobile on-screen numeric keypad that feeds OTP + PIN entry (Task
 * F1.3). Pure chrome: it holds no input state itself, it only reports taps
 * via `onDigit`/`onBackspace` — the calling step owns the value.
 */
export function Keypad({ onDigit, onBackspace, disabled }: KeypadProps) {
  return (
    <div
      role="group"
      aria-label="Numeric keypad"
      className="grid grid-cols-3 gap-2.5"
    >
      {KEYPAD_LAYOUT.map((key, index) => {
        if (key === null) {
          return <div key={`spacer-${index}`} aria-hidden="true" />
        }

        if (key === "backspace") {
          return (
            <Button
              key="backspace"
              type="button"
              variant="ghost"
              size="lg"
              disabled={disabled}
              onClick={onBackspace}
              aria-label="Backspace"
              className="h-[54px] rounded-2xl text-2xl font-semibold text-foreground"
            >
              ⌫
            </Button>
          )
        }

        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="lg"
            disabled={disabled}
            onClick={() => onDigit(key)}
            className="h-[54px] rounded-2xl bg-card text-2xl font-semibold text-foreground shadow-xs hover:bg-card/80"
          >
            {key}
          </Button>
        )
      })}
    </div>
  )
}
