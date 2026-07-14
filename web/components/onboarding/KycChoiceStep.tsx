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
          "flex-none px-[26px] pt-16 pb-[30px] text-primary-foreground",
          "bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)]",
          "lg:bg-none lg:px-0 lg:pt-0 lg:pb-0 lg:text-foreground"
        )}
      >
        <div
          aria-hidden="true"
          className="flex h-[52px] w-[52px] animate-hs-pop items-center justify-center rounded-full bg-success-muted lg:h-12 lg:w-12"
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

        <h1 className="mt-[18px] text-[27px] leading-[1.1] font-extrabold tracking-[-0.025em] lg:text-3xl lg:tracking-[-0.028em]">
          You&apos;re in{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-[9px] max-w-[300px] text-[14.5px] leading-[1.45] text-primary-foreground/80 lg:hidden">
          Your wallet is ready to use. One last thing — verifying your identity
          unlocks sending, cash-out and higher limits.
        </p>
        <p className="mt-[10px] hidden text-[15px] leading-relaxed text-muted-foreground lg:block">
          Your wallet is ready. Verifying your identity unlocks sending,
          cash-out and higher limits — or explore first and do it later.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-[13px] overflow-y-auto px-5 pt-5 pb-0 lg:flex-none lg:gap-3 lg:overflow-visible lg:p-0">
        <button
          type="button"
          onClick={onVerifyNow}
          className="flex items-center gap-[13px] rounded-[18px] border-2 border-accent bg-card p-[18px] text-left shadow-cta transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:gap-[15px] lg:p-5"
        >
          <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] bg-accent text-accent-foreground lg:h-12 lg:w-12">
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
            <span className="block text-[16.5px] font-extrabold text-foreground lg:text-[17px]">
              Verify now
            </span>
            <span className="mt-0.5 block text-[13.5px] text-muted-foreground">
              BVN or NIN + a selfie · about 1 minute
            </span>
            <span className="mt-[14px] flex flex-wrap gap-[7px]">
              <StatusPill tone="success">Unlock sending</StatusPill>
              <StatusPill tone="success">Cash out to bank</StatusPill>
              <StatusPill tone="success">Higher limits</StatusPill>
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={onVerifyLater}
          className="flex items-center gap-[13px] rounded-[18px] border border-border bg-card p-[18px] text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:gap-[15px] lg:p-5"
        >
          <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] bg-muted text-muted-foreground lg:h-12 lg:w-12">
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
            <span className="block text-[16.5px] font-extrabold text-foreground lg:text-[17px]">
              Explore first, verify later
            </span>
            <span className="mt-0.5 block text-[13.5px] text-muted-foreground">
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
