"use client"

import { StatusPill } from "@/components/shared/status-pill"
import { cn } from "@/lib/utils"
import type { KycChoiceStepProps } from "@/types"

/**
 * The verify-now-or-later fork after account creation. Presentational only —
 * the wizard shell (Task F1.4) wires `onVerifyNow` to `goto('sumsub')` and
 * `onVerifyLater` to `setData({kycChoice:'later'}); goto('done')`.
 *
 * On MOBILE the mockup renders a dark-green header band — the success check
 * + greeting, white on the brand gradient (the same
 * `linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)`
 * `OnboardingRail`/`WelcomeStep` use) — above the two choice cards and the
 * footer note on the cream body. On DESKTOP everything sits on the cream
 * right-panel (the rail supplies the green), so the band is switched off at
 * the `lg` breakpoint; the wizard shell renders this step with no wrapper of
 * its own on mobile, so there is only one place the background is applied.
 */
export function KycChoiceStep({
  firstName,
  onVerifyNow,
  onVerifyLater,
}: KycChoiceStepProps) {
  return (
    <div className="flex min-h-svh flex-col lg:min-h-0 lg:gap-6">
      <div
        data-testid="kyc-header-band"
        className={cn(
          "flex-none px-6 pt-16 pb-8 text-primary-foreground",
          "bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)]",
          "lg:bg-none lg:px-0 lg:pt-0 lg:pb-0 lg:text-foreground"
        )}
      >
        <div
          aria-hidden="true"
          className="flex h-12 w-12 animate-hs-pop items-center justify-center rounded-full bg-success-muted"
        >
          <svg width="24" height="24" viewBox="0 0 26 26" fill="none">
            <path
              d="M6 13.5l4.5 4.5L20 8"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-success"
            />
          </svg>
        </div>

        <h1 className="mt-4 text-2xl font-extrabold tracking-tight lg:mt-6 lg:text-3xl">
          You&apos;re in{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-primary-foreground/80 lg:hidden">
          Your wallet is ready to use. One last thing — verifying your identity
          unlocks sending, cash-out and higher limits.
        </p>
        <p className="mt-2 hidden text-base leading-relaxed text-muted-foreground lg:block">
          Your wallet is ready. Verifying your identity unlocks sending,
          cash-out and higher limits — or explore first and do it later.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 pt-5 pb-6 lg:flex-none lg:gap-6 lg:overflow-visible lg:p-0">
        <button
          type="button"
          onClick={onVerifyNow}
          className="flex items-center gap-4 rounded-2xl border-2 border-accent bg-card p-5 text-left shadow-cta transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path
                d="M11 2l7 2.6v5.2c0 4.4-3 8-7 9.2-4-1.2-7-4.8-7-9.2V4.6L11 2z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M7.8 11l2.2 2.2L14.4 8.4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="flex-1">
            <span className="block text-base font-extrabold text-foreground">
              Verify now
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              BVN or NIN + a selfie · about 1 minute
            </span>
            <span className="mt-3 flex flex-wrap gap-1.5">
              <StatusPill tone="success">Unlock sending</StatusPill>
              <StatusPill tone="success">Cash out to bank</StatusPill>
              <StatusPill tone="success">Higher limits</StatusPill>
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={onVerifyLater}
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle
                cx="11"
                cy="11"
                r="8"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M11 6.5V11l3 2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="flex-1">
            <span className="block text-base font-extrabold text-foreground">
              Explore first, verify later
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              Look around <span className="lg:hidden">the app </span>— you can
              verify anytime.
            </span>
          </span>
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Verification is required{" "}
          <span className="lg:hidden">by CBN &amp; NDPR </span>
          before you can send or cash out. It&apos;s quick, and your data is
          encrypted.
        </p>
      </div>
    </div>
  )
}
