"use client"

import { SumsubVerification } from "@/components/kyc/SumsubVerification"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { KycTierLevel } from "@handshake-agent/contracts/dto"
import type { SumsubVerificationDialogProps } from "@/types"

const LEVEL_DESCRIPTION: Record<KycTierLevel, string> = {
  tier_2:
    "Complete a quick document + liveness check to unlock sending, selling and swapping.",
  tier_3:
    "Add a proof of address (utility bill, bank statement) to raise your limits.",
}

/**
 * SumsubVerificationDialog — opens the Sumsub verification flow in a modal for a
 * focused experience (used by Settings and the onboarding wizard). It wraps the
 * existing SumsubVerification surface; the engine still grants the tier
 * server-side off the signed Sumsub webhook (root §3.1) — the dialog only
 * collects. The dialog closes itself once the applicant submits.
 *
 * Sizing: near full-height on mobile (the id + liveness steps need room); a
 * large centered dialog on desktop, with the Sumsub iframe scrolling in its own
 * body region.
 */
export function SumsubVerificationDialog({
  open,
  onOpenChange,
  level,
  onSubmitted,
}: SumsubVerificationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-4 overflow-hidden sm:h-auto sm:max-h-[90vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Verify your identity</DialogTitle>
          <DialogDescription>{LEVEL_DESCRIPTION[level]}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          <SumsubVerification
            level={level}
            onSubmitted={() => {
              onSubmitted?.()
              onOpenChange(false)
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
