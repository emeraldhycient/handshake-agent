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
          "flex-none px-6 pt-[70px] pb-[34px] text-center text-primary-foreground",
          "bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)]",
          "lg:bg-none lg:px-0 lg:pt-0 lg:pb-0 lg:text-left lg:text-foreground"
        )}
      >
        <div className="relative mx-auto h-16 w-16 lg:mx-0">
          <div
            aria-hidden="true"
            className="absolute inset-0 animate-hs-ring rounded-full border-2 border-success-bright"
          />
          <div
            aria-hidden="true"
            className="relative flex h-16 w-16 animate-hs-pop items-center justify-center rounded-full bg-success-muted"
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

        <h1 className="mt-4 text-2xl font-extrabold tracking-tight lg:mt-6 lg:text-3xl">
          Welcome to Handshake{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-primary-foreground/80 lg:text-base lg:text-muted-foreground">
          {subcopy}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 pt-5 pb-4 lg:flex-none lg:gap-6 lg:overflow-visible lg:p-0">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex h-[50px] w-[50px] flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-deep">
            <span className="font-mono text-xl font-extrabold text-accent">
              ₦
            </span>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-muted-foreground">
              Naira balance
            </p>
            <p className="text-xl font-extrabold text-foreground tabular-nums">
              {formatFiat(0, "NGN")}
            </p>
          </div>
          <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
        </div>

        {skipped && (
          <div className="rounded-2xl border border-warn bg-warn-muted p-4">
            <div className="flex-1">
              <p className="text-sm font-bold text-warn-foreground lg:hidden">
                Verify to unlock everything
              </p>
              <p className="hidden text-sm font-bold text-warn-foreground lg:block">
                Verify to unlock sending &amp; cash-out
              </p>
              <p className="mt-0.5 text-xs text-warn-foreground/80 lg:hidden">
                Sending &amp; cash-out are locked until you verify.
              </p>
              <p className="mt-0.5 hidden text-xs text-warn-foreground/80 lg:block">
                Takes about a minute.
              </p>
            </div>
            <Button
              type="button"
              onClick={onVerifyNow}
              className="mt-3 w-full bg-primary-deep text-primary-foreground hover:bg-primary-deep/90"
            >
              <span className="lg:hidden">Verify now · 1 min</span>
              <span className="hidden lg:inline">Verify now</span>
            </Button>
          </div>
        )}

        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
          <div className="relative h-11 w-11 flex-none">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep">
              <div className="h-4 w-4 rounded-md bg-primary-deep" />
            </div>
            <div className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-card bg-success-bright" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-foreground">
              Your agent is ready
            </p>
            <p className="text-xs text-muted-foreground">
              Just say &ldquo;Buy ₦50,000 of USDT&rdquo; to begin.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-none px-6 pt-3 pb-8 lg:p-0">
        <Button size="lg" className="w-full" onClick={() => router.push("/")}>
          Open my wallet
        </Button>
      </div>
    </div>
  )
}
