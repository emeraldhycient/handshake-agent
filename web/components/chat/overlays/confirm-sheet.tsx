"use client"

import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ConfirmBody } from "@/components/chat/overlays/confirm-body"
import type { ConfirmSheetProps } from "@/types/components"

/**
 * ConfirmSheet — renders a bottom Sheet on mobile and a centred Dialog on
 * desktop, sharing a single `ConfirmBody` subtree. This component only wires
 * the modal shell to the caller's callbacks — it never executes a transaction.
 * Esc / scrim click routes to `onCancel` via `onOpenChange`.
 */
export function ConfirmSheet({
  open,
  payload,
  density,
  onConfirm,
  onCancel,
  error,
}: ConfirmSheetProps) {
  // Guard: don't render the shell at all when there is nothing to show.
  if (!open || !payload) return null

  if (density === "mobile") {
    return (
      <Sheet
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onCancel()
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={cn(
            "rounded-t-[28px] bg-card-muted px-0 pt-0 pb-8",
            "max-h-[92%] overflow-y-auto"
          )}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-[5px] w-10 rounded-full bg-border" />
          </div>
          {/* Radix requires a title; use the real text sr-only so AT reads it. */}
          <SheetTitle className="sr-only">{payload.title}</SheetTitle>
          <SheetDescription className="sr-only">
            {payload.subtitle}
          </SheetDescription>
          <div className="px-5 pt-1.5">
            <ConfirmBody
              payload={payload}
              error={error}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "w-[430px] max-w-[calc(100%-2rem)] rounded-[22px] bg-card-muted",
          "max-h-[90%] overflow-y-auto"
        )}
      >
        <DialogTitle className="sr-only">{payload.title}</DialogTitle>
        <DialogDescription className="sr-only">
          {payload.subtitle}
        </DialogDescription>
        <ConfirmBody
          payload={payload}
          error={error}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  )
}
