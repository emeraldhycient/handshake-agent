"use client"

/**
 * SumsubVerification — the Sumsub WebSDK verification surface.
 *
 * Mints a WebSDK access token for the requested rung (tier_2 = document +
 * liveness, tier_3 = proof of address) via POST /kyc/sumsub/token, then hands
 * it to Sumsub's `<SumsubWebSdk>`. The applicant completes the flow inside the
 * E2E-encrypted iframe; when they submit, `onSubmitted` fires so the caller can
 * move to an "in review" state.
 *
 * Funds-safety (root §3.1): this component only COLLECTS. The tier is granted
 * server-side by the deterministic engine off the signed Sumsub webhook — never
 * from anything the SDK reports here. A leaked/forged client message can at most
 * change local UI, never a KYC tier.
 *
 * Branches: loading (minting) / error (mint failed → retry) / data (SDK). There
 * is no "empty" branch — a token mint either yields a token or errors.
 */
import { useEffect, useRef } from "react"
import SumsubWebSdk from "@sumsub/websdk-react"
import { useSumsubToken } from "@/lib/query/kyc-onboarding"
import { Button } from "@/components/ui/button"
import { toErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import type { SumsubVerificationProps } from "@/types"

// Non-visual SDK options: we control the viewport tag ourselves and let the
// iframe size to its content.
const SDK_OPTIONS = { addViewportTag: false, adaptIframeHeight: true } as const
const SDK_CONFIG = { lang: "en" } as const

// WebSDK message types that mean the applicant has finished submitting for this
// level. `applicantReviewComplete` also covers instant-decision sandbox flows.
const DONE_MESSAGES = new Set([
  "idCheck.onApplicantSubmitted",
  "idCheck.applicantReviewComplete",
])

export function SumsubVerification({
  level,
  onSubmitted,
  onBack,
  className,
}: SumsubVerificationProps) {
  const { mutate, mutateAsync, data, isPending, isError, error } =
    useSumsubToken()

  // Mint the initial token once on mount. The mutation IS the TanStack Query
  // server-state layer (root §5); this effect only kicks it — no raw fetch here.
  const requested = useRef(false)
  useEffect(() => {
    if (requested.current) return
    requested.current = true
    mutate(level)
  }, [level, mutate])

  // Sumsub calls this when the current token nears expiry — mint a fresh one.
  async function refreshToken(): Promise<string> {
    const res = await mutateAsync(level)
    return res.token
  }

  function handleMessage(type: string) {
    if (DONE_MESSAGES.has(type)) onSubmitted?.()
  }

  // ── loading ──
  if (!data && !isError) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-4 py-10 text-center",
          className
        )}
      >
        <div
          aria-hidden="true"
          className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent"
        />
        <p className="text-base font-semibold text-foreground">
          Preparing verification…
        </p>
        {isPending && (
          <span className="sr-only" role="status">
            Loading
          </span>
        )}
      </div>
    )
  }

  // ── error ──
  if (isError || !data) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-4 py-10 text-center",
          className
        )}
      >
        <p className="text-base font-semibold text-danger">
          We couldn&apos;t start verification.
        </p>
        <p className="text-sm text-muted-foreground">
          {toErrorMessage(error) ?? "Something went wrong. Please try again."}
        </p>
        <div className="flex gap-3">
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
          )}
          <Button type="button" onClick={() => mutate(level)}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  // ── data ──
  return (
    <div className={className}>
      <SumsubWebSdk
        accessToken={data.token}
        expirationHandler={refreshToken}
        config={SDK_CONFIG}
        options={SDK_OPTIONS}
        onMessage={handleMessage}
        onError={(e) => {
          // The engine is the source of truth; a client SDK error is UI-only.
          // Surface it to the console for support and let the user retry via
          // the SDK's own controls.
          console.error("[SumsubVerification] SDK error", e)
        }}
      />
    </div>
  )
}
