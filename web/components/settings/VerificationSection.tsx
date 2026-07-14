"use client"

import { useState } from "react"
import type { KycTierLevel } from "@handshake-agent/contracts/dto"
import { SumsubVerificationDialog } from "@/components/kyc/SumsubVerificationDialog"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { useProfile } from "@/lib/query/auth"
import { useRefreshIdentity } from "@/lib/query/kyc-onboarding"
import { tierLabel } from "@/lib/format/tier"
import {
  VERIFICATION_RUNG_COPY,
  VERIFICATION_TERMINAL_COPY,
} from "@/constants/settings"

/**
 * Settings "Identity verification" card — resume / climb the KYC ladder.
 *
 * Reads the current tier and offers the next rung inline: tier_1 → tier_2
 * (document + liveness, unlocks send/sell/swap), tier_2 → tier_3 (proof of
 * address, raises limits), tier_3 → fully verified. A pending submission shows
 * an in-review state with no CTA.
 *
 * Funds-safety (root §3.1): this card only launches the Sumsub flow. The tier is
 * granted server-side off the signed webhook — never from anything the SDK
 * reports. After submission we refresh identity and re-read until it catches up.
 */

/** The next rung a user at `kycTier` can climb, or null if fully verified. */
function nextLevel(kycTier: string): KycTierLevel | null {
  if (kycTier === "tier_3") return null
  if (kycTier === "tier_2") return "tier_3"
  // tier_1, unverified, or anything below tier_2 → document + liveness first.
  return "tier_2"
}

export function VerificationSection() {
  const profile = useProfile()
  const refreshIdentity = useRefreshIdentity()
  const [verifying, setVerifying] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // The panel owns page-level loading; render nothing until identity is known.
  if (!profile.data) return null

  const { kycTier, kycStatus } = profile.data
  const inReview = submitted || kycStatus === "pending_review"
  const level = nextLevel(kycTier)

  function handleSubmitted() {
    setSubmitted(true)
    setVerifying(false)
    refreshIdentity()
  }

  return (
    <div className="rounded-[16px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-[13px]">
        <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Identity verification
        </p>
        <StatusPill tone={inReview ? "warn" : "neutral"}>
          {inReview ? "In review" : tierLabel(kycTier)}
        </StatusPill>
      </div>

      <div className="px-5 py-[15px]">
        <VerificationBody
          inReview={inReview}
          level={level}
          onVerify={() => setVerifying(true)}
        />
      </div>

      {level && (
        <SumsubVerificationDialog
          open={verifying}
          onOpenChange={setVerifying}
          level={level}
          onSubmitted={handleSubmitted}
        />
      )}
    </div>
  )
}

interface VerificationBodyProps {
  inReview: boolean
  level: KycTierLevel | null
  onVerify: () => void
}

function VerificationBody({
  inReview,
  level,
  onVerify,
}: VerificationBodyProps) {
  const copy = inReview
    ? VERIFICATION_TERMINAL_COPY.review
    : level
      ? VERIFICATION_RUNG_COPY[level]
      : VERIFICATION_TERMINAL_COPY.complete

  const showCta = !inReview && level !== null

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{copy.heading}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {copy.blurb}
        </p>
      </div>
      {showCta && (
        <Button className="w-full sm:w-auto sm:self-start" onClick={onVerify}>
          {VERIFICATION_RUNG_COPY[level].cta}
        </Button>
      )}
    </div>
  )
}
