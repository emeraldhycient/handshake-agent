"use client"

import { cn } from "@/lib/utils"
import { PinPadInner } from "@/components/chat/overlays/pin-pad-inner"
import type { PinPadProps } from "@/types/components"

/**
 * PinPad — full-cover PIN entry overlay. Pure event emitter: it never stores or
 * executes anything (the calling store accumulates digits via `onDigit` and runs
 * execution when the PIN is complete). This wrapper only picks the mobile
 * (full-screen) vs desktop (centred card) shell; the layout lives in PinPadInner.
 */
export function PinPad({
  open,
  pinLength,
  density,
  onDigit,
  onBack,
  onFaceId,
  onCancel,
  error,
  errorText,
}: PinPadProps) {
  // Emit-only: the shell wraps this in a focus-trap dialog. A PIN gate is never
  // Esc-dismissed — only via Cancel.
  if (!open) return null

  const isDesktop = density === "desktop"
  const resolvedError = errorText ?? error

  const inner = (
    <PinPadInner
      pinLength={pinLength}
      density={density}
      onDigit={onDigit}
      onBack={onBack}
      onFaceId={onFaceId}
      onCancel={onCancel}
      error={resolvedError}
    />
  )

  return (
    <div
      className={cn(
        "inset-0 z-[45] flex flex-col bg-gradient-to-b from-primary to-primary-deep text-primary-foreground",
        isDesktop ? "fixed items-center justify-center" : "absolute"
      )}
    >
      {isDesktop ? (
        <div className="w-[340px] rounded-[24px] bg-gradient-to-b from-primary to-primary-deep px-[26px] pt-[30px] pb-6 text-primary-foreground shadow-2xl">
          {inner}
        </div>
      ) : (
        inner
      )}
    </div>
  )
}
