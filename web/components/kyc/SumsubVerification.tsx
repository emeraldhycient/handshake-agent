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
import { useEffect, useState } from "react"
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
  const { mutate, mutateAsync, data, isPending, isError, error, status } =
    useSumsubToken()
  // A runtime error INSIDE the mounted SDK iframe (distinct from a token-mint
  // failure). Without surfacing it the user would sit on a broken/empty embed;
  // setting this routes them to the recoverable error branch below.
  const [sdkError, setSdkError] = useState<string | null>(null)

  // Mint the token on mount. Guard on the mutation's own `idle` STATUS — NOT a
  // `useRef` "did-run" flag. React 19 StrictMode's dev double-mount preserves a
  // ref across the throwaway probe remount, so a `requested` ref set during the
  // discarded probe leaves the SURVIVING instance reading `true` and skipping
  // its own mint — stuck on "Preparing…" forever (the probe fires the request;
  // the visible instance never does). `status` resets with each fresh mutation
  // instance, so `idle` triggers the mint exactly once per real mount. In dev
  // StrictMode both instances mint, but Sumsub dedupes the applicant by userId,
  // so the extra token request is inert. The mutation IS the TanStack Query
  // server-state layer (root §5); this effect only kicks it — no raw fetch.
  useEffect(() => {
    if (status === "idle") mutate(level)
  }, [level, status, mutate])

  // Sumsub calls this when the current token nears expiry — mint a fresh one.
  async function refreshToken(): Promise<string> {
    const res = await mutateAsync(level)
    return res.token
  }

  function handleMessage(type: string) {
    if (DONE_MESSAGES.has(type)) onSubmitted?.()
  }

  function retry() {
    setSdkError(null)
    mutate(level)
  }

  // A persistent, low-emphasis escape hatch. The Sumsub step is the highest-
  // friction moment of onboarding; without this the user is trapped once the
  // SDK mounts (the shell renders this step full-bleed with no chrome back
  // button). `onBack` returns to the KYC choice, where "verify later" reaches
  // the app.
  const backControl = onBack ? (
    <button
      type="button"
      onClick={onBack}
      className="text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      ← Back, I&apos;ll verify later
    </button>
  ) : null

  // ── loading ──
  if (!data && !isError && !sdkError) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {backControl}
        <div className="flex flex-col items-center gap-4 py-10 text-center">
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
      </div>
    )
  }

  // ── error (token-mint failure OR a runtime error inside the SDK iframe) ──
  if (isError || !data || sdkError) {
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
          {sdkError ??
            toErrorMessage(error) ??
            "Something went wrong. Please try again."}
        </p>
        <div className="flex gap-3">
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
          )}
          <Button type="button" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  // ── data ──
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {backControl}
      <SumsubWebSdk
        accessToken={data.token}
        expirationHandler={refreshToken}
        config={SDK_CONFIG}
        options={SDK_OPTIONS}
        onMessage={handleMessage}
        onError={(e) => {
          // The engine is the source of truth; a client SDK error is UI-only.
          // Log it for support AND surface it to the user (→ error branch) so a
          // broken iframe is never a silent dead-end.
          console.error("[SumsubVerification] SDK error", e)
          setSdkError(
            toErrorMessage(e) ?? "Verification couldn't load. Please try again."
          )
        }}
      />
    </div>
  )
}
