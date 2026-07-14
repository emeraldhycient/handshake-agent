"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/shared/status-pill"
import { formatFiat } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DoneStepProps } from "@/types"
import type { StatusTone } from "@/lib/schemas"

function statusBadge(kycStatus?: string): { label: string; tone: StatusTone } {
  if (kycStatus === "verified") return { label: "Verified", tone: "success" }
  if (kycStatus === "pending_review")
    return { label: "In review", tone: "warn" }
  return { label: "Unverified", tone: "neutral" }
}

/**
 * Final screen — the wallet is live; verify now (if skipped) or open the
 * app. On MOBILE the mockup renders a dark-green header band — a centered
 * success check + greeting, white on the brand gradient (the same
 * `linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)`
 * `OnboardingRail`/`WelcomeStep`/`KycChoiceStep` use) — above a scrollable
 * cream body and a pinned "Open my wallet" footer. On DESKTOP everything
 * sits inline on the cream right-panel (the rail supplies the green), so
 * the band/scroll/pinned-footer treatment is switched off at the `lg`
 * breakpoint; the wizard shell renders this step with no wrapper of its own
 * on mobile, so there is only one place the background is applied.
 */
export function DoneStep({
  firstName,
  kycStatus,
  skipped,
  onVerifyNow,
}: DoneStepProps) {
  const router = useRouter()
  const badge = statusBadge(kycStatus)
  const subcopy = skipped
    ? "Your wallet is live. Add money and explore — verify whenever you're ready to send."
    : kycStatus === "verified"
      ? "You're fully verified. Send, receive, swap and cash out — all from a chat."
      : "We're reviewing your verification — you'll get a notification once it's done."

  return (
    <div className="flex min-h-svh flex-col lg:min-h-0 lg:gap-6">
      <div
        data-testid="done-header-band"
        className={cn(
          "flex-none px-[26px] pt-[70px] pb-[34px] text-center text-primary-foreground",
          "bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)]",
          "lg:bg-none lg:px-0 lg:pt-0 lg:pb-0 lg:text-left lg:text-foreground"
        )}
      >
        <div className="relative mx-auto h-[74px] w-[74px] lg:mx-0 lg:h-16 lg:w-16">
          <div
            aria-hidden="true"
            className="absolute inset-0 animate-hs-ring rounded-full border-2 border-success-bright"
          />
          <div
            aria-hidden="true"
            className="relative flex h-[74px] w-[74px] animate-hs-pop items-center justify-center rounded-full bg-success-muted lg:h-16 lg:w-16"
          >
            <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
              <path
                d="M9 18.5l6 6L27 11"
                stroke="currentColor"
                strokeWidth="3.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
              />
            </svg>
          </div>
        </div>

        <h1 className="mt-[22px] text-[27px] font-extrabold tracking-[-0.025em] lg:text-3xl lg:tracking-[-0.028em]">
          Welcome to Handshake{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-[9px] text-[14.5px] leading-relaxed text-primary-foreground/80 lg:mt-[10px] lg:text-[15px] lg:text-muted-foreground">
          {subcopy}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pt-5 pb-0 lg:flex-none lg:gap-6 lg:overflow-visible lg:p-0">
        <div className="flex items-center gap-[14px] rounded-[18px] border border-border bg-card p-[18px] lg:gap-[15px] lg:p-5">
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-gradient-to-br from-primary to-primary-deep lg:h-[50px] lg:w-[50px]">
            <span className="font-mono text-xl font-extrabold text-accent">
              ₦
            </span>
          </div>
          <div className="flex-1">
            <p className="text-[12.5px] font-semibold text-muted-foreground">
              Naira balance
            </p>
            <p className="text-[22px] font-extrabold text-foreground tabular-nums lg:text-[23px]">
              {formatFiat(0, "NGN")}
            </p>
          </div>
          <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
        </div>

        {skipped && (
          <div className="rounded-[18px] border border-warn bg-warn-muted px-[17px] py-4 lg:p-[18px]">
            <div className="flex-1">
              <p className="text-[14.5px] font-bold text-warn-foreground lg:hidden">
                Verify to unlock everything
              </p>
              <p className="hidden text-[15px] font-bold text-warn-foreground lg:block">
                Verify to unlock sending &amp; cash-out
              </p>
              <p className="mt-0.5 text-[12.5px] text-warn-foreground/80 lg:hidden">
                Sending &amp; cash-out are locked until you verify.
              </p>
              <p className="mt-0.5 hidden text-[13px] text-warn-foreground/80 lg:block">
                Takes about a minute.
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              onClick={onVerifyNow}
              className="mt-[13px] w-full rounded-[12px] bg-primary-deep px-[18px] text-sm font-bold text-primary-foreground hover:bg-primary-deep/90 lg:w-auto"
            >
              <span className="lg:hidden">Verify now · 1 min</span>
              <span className="hidden lg:inline">Verify now</span>
            </Button>
          </div>
        )}

        <div className="flex items-center gap-[13px] rounded-[18px] border border-border bg-card p-[18px]">
          <div className="relative h-11 w-11 flex-none">
            <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-br from-accent to-accent-deep">
              <div className="h-4 w-4 rounded-md bg-primary-deep" />
            </div>
            <div className="absolute -right-0.5 -bottom-0.5 h-[13px] w-[13px] rounded-full border-2 border-card bg-success-bright" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-bold text-foreground">
              Your agent is ready
            </p>
            <p className="text-[13px] text-muted-foreground">
              Just say &ldquo;Buy ₦50,000 of USDT&rdquo; to begin.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-none px-5 pt-[14px] pb-[30px] lg:p-0">
        <Button
          variant="accent"
          size="xl"
          className="w-full"
          onClick={() => router.push("/")}
        >
          Open my wallet
        </Button>
      </div>
    </div>
  )
}
