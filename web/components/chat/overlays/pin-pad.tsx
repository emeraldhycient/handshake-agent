"use client"

import { DeleteIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { PinPadProps } from "@/types/components"

/** The 12 keypad slots in order: 1-9, Face ID, 0, Backspace */
const PIN_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

/**
 * PinPad — full-cover PIN entry overlay.
 *
 * This component is a pure event emitter. It never stores or executes anything.
 * The calling layer (Zustand store) accumulates digits via `onDigit` and
 * triggers execution only when the 4-digit PIN is complete.
 *
 * Density controls sizing; the dark green gradient background is token-based
 * (`from-primary` / `to-primary-deep`).
 */
export function PinPad({
  open,
  pinLength,
  density,
  onDigit,
  onBack,
  onFaceId,
  onCancel,
}: PinPadProps) {
  // TODO(PHASE-15): the shell must wrap this in a focus trap with role="dialog" aria-modal="true" aria-labelledby.
  // PinPad stays emit-only (no Esc-dismiss — a PIN gate must not be dismissable by Escape; use the Cancel button).
  if (!open) return null

  const isDesktop = density === "desktop"

  return (
    <div
      className={cn(
        "inset-0 z-[45] flex flex-col bg-gradient-to-b from-primary to-primary-deep text-primary-foreground",
        isDesktop
          ? // Desktop: centred card inside a scrim overlay
            "fixed items-center justify-center"
          : "absolute"
      )}
    >
      {isDesktop ? (
        /* Desktop: compact card */
        <div className="w-[340px] rounded-[24px] bg-gradient-to-b from-primary to-primary-deep px-[26px] pt-[30px] pb-6 text-primary-foreground shadow-2xl">
          <PinPadInner
            pinLength={pinLength}
            density={density}
            onDigit={onDigit}
            onBack={onBack}
            onFaceId={onFaceId}
            onCancel={onCancel}
          />
        </div>
      ) : (
        /* Mobile: full-screen layout */
        <PinPadInner
          pinLength={pinLength}
          density={density}
          onDigit={onDigit}
          onBack={onBack}
          onFaceId={onFaceId}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}

/** Inner layout — shared between mobile full-screen and desktop card */
function PinPadInner({
  pinLength,
  density,
  onDigit,
  onBack,
  onFaceId,
  onCancel,
}: Omit<PinPadProps, "open">) {
  const isDesktop = density === "desktop"

  return (
    <>
      {/* Header: icon + heading + subtitle + dots */}
      <div className={cn("text-center", isDesktop ? "" : "px-6 pt-16")}>
        <div
          className={cn(
            "mx-auto mb-4 flex items-center justify-center rounded-[15px] bg-white/10",
            isDesktop ? "mb-3.5 h-[46px] w-[46px] rounded-[14px]" : "h-12 w-12"
          )}
          aria-hidden="true"
        >
          {/* Lock icon with accent color */}
          <svg
            width={isDesktop ? 19 : 20}
            height={isDesktop ? 21 : 22}
            viewBox="0 0 20 22"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 9V5.5a5 5 0 0110 0V9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="text-accent"
            />
            <rect
              x="2.5"
              y="9"
              width="15"
              height="11"
              rx="3"
              className="fill-accent"
            />
          </svg>
        </div>

        <p className={cn("font-bold", isDesktop ? "text-[19px]" : "text-xl")}>
          Enter your PIN
        </p>
        <p
          className={cn(
            "mt-1 text-primary-foreground/65",
            isDesktop ? "mt-1 text-[13px]" : "mt-[5px] text-[13.5px]"
          )}
        >
          Confirm to authorise this transaction
        </p>

        {/* PIN dots */}
        <div
          className={cn(
            "flex justify-center",
            isDesktop ? "mt-[22px] gap-[15px]" : "mt-[26px] gap-4"
          )}
          role="status"
          aria-label={`${pinLength} of 4 digits entered`}
        >
          {Array.from({ length: 4 }).map((_, i) => {
            const filled = i < pinLength
            return (
              <div
                key={i}
                data-filled={filled ? "true" : "false"}
                className={cn(
                  "h-[15px] w-[15px] rounded-full border-2",
                  filled
                    ? "border-accent bg-accent"
                    : "border-primary-foreground/50 bg-transparent"
                )}
              />
            )
          })}
        </div>
      </div>

      {/* Spacer pushes keypad to bottom on mobile */}
      {!isDesktop && <div className="flex-1" />}

      {/* Keypad grid */}
      <div
        className={cn(
          "grid grid-cols-3",
          isDesktop ? "mt-6 gap-3" : "gap-x-6 gap-y-3.5 px-7 pb-[18px]"
        )}
      >
        {/* Digits 1–9 */}
        {PIN_DIGITS.map((d) => (
          <Button
            key={d}
            variant="ghost"
            onClick={() => onDigit(d)}
            className={cn(
              "font-semibold text-primary-foreground hover:bg-white/10 hover:text-primary-foreground",
              isDesktop
                ? "h-[52px] rounded-[15px] bg-white/8 text-[23px]"
                : "h-[62px] rounded-[18px] bg-white/8 text-[26px]"
            )}
          >
            {d}
          </Button>
        ))}

        {/* Face ID button (bottom-left) */}
        <Button
          variant="ghost"
          onClick={onFaceId}
          aria-label="Use Face ID"
          className={cn(
            "font-bold text-accent hover:bg-transparent hover:text-accent",
            isDesktop
              ? "h-[52px] rounded-[15px] text-[12px]"
              : "h-[62px] rounded-[18px] text-[12.5px]"
          )}
        >
          Face ID
        </Button>

        {/* Digit 0 (bottom-center) */}
        <Button
          variant="ghost"
          onClick={() => onDigit("0")}
          className={cn(
            "font-semibold text-primary-foreground hover:bg-white/10 hover:text-primary-foreground",
            isDesktop
              ? "h-[52px] rounded-[15px] bg-white/8 text-[23px]"
              : "h-[62px] rounded-[18px] bg-white/8 text-[26px]"
          )}
        >
          0
        </Button>

        {/* Backspace button (bottom-right) */}
        <Button
          variant="ghost"
          onClick={onBack}
          aria-label="Backspace"
          className={cn(
            "text-primary-foreground hover:bg-transparent hover:text-primary-foreground",
            isDesktop ? "h-[52px] rounded-[15px]" : "h-[62px] rounded-[18px]"
          )}
        >
          <DeleteIcon
            className={cn(isDesktop ? "h-6 w-6" : "h-[26px] w-[26px]")}
            aria-hidden="true"
          />
        </Button>
      </div>

      {/* Cancel */}
      <Button
        variant="ghost"
        onClick={onCancel}
        className={cn(
          "w-full text-primary-foreground/70 hover:bg-transparent hover:text-primary-foreground/70",
          isDesktop ? "mt-4 py-1.5 text-[14px]" : "pt-2 pb-[34px] text-[14px]"
        )}
      >
        Cancel
      </Button>
    </>
  )
}
