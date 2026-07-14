"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AddCryptoForm } from "@/components/chat/cards/needs-beneficiary/add-crypto-form"
import type { SaveRecipientButtonProps } from "@/types/components"

/**
 * "Save this recipient" — rendered by ReceiptCard only for a completed SEND
 * to a raw (unsaved) address (action==="send" && no beneficiaryLabel — a send
 * to an already-saved beneficiary has nothing to save).
 *
 * Opens the STANDARD add-crypto flow (AddCryptoForm, `add` mode) in a dialog —
 * PIN-gated via useAddCryptoAddress (§3.3). This is a deliberate,
 * independently step-up-gated action, unlike save-before-send (which folds
 * into the send's own execute authorization).
 *
 * §3.5: the receipt only ever holds the MASKED destination — this dialog
 * never pre-fills or displays the full address. The user re-enters it, same
 * as any other standalone "add a crypto address" flow.
 */
export function SaveRecipientButton({
  density,
  className,
}: SaveRecipientButtonProps) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const isMobile = density === "mobile"

  if (saved) {
    return (
      <p
        className={cn(
          "font-bold text-success",
          isMobile ? "text-[13px]" : "text-[12.5px]",
          className
        )}
      >
        Recipient saved
      </p>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "cursor-pointer border-none bg-transparent p-0 font-bold text-primary",
          isMobile ? "text-[13px]" : "text-[12.5px]",
          className
        )}
      >
        Save this recipient
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-extrabold">
              Save this recipient
            </DialogTitle>
          </DialogHeader>
          <AddCryptoForm
            onResolve={() => {
              setOpen(false)
              setSaved(true)
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
