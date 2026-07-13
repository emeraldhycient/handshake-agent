"use client"

import Link from "next/link"
import { BrandMark } from "@/components/shared/brand-mark"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { WelcomeStepProps } from "@/types"

/**
 * First screen of the onboarding wizard. On MOBILE the mockup renders this
 * full-bleed, edge-to-edge on the dark-green brand gradient —
 * `linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)`, the
 * exact treatment `OnboardingRail` uses for the desktop brand rail, reused
 * here via those same tokens so mobile and desktop never drift in color. On
 * DESKTOP this same content sits on the cream right-panel next to the rail
 * (the rail itself supplies the green), so the gradient/padding/white-text
 * treatment is switched off at the `lg` breakpoint — the wizard shell
 * (`OnboardingWizard`) renders this step with no wrapper of its own on
 * mobile so there is only one place the background is ever applied. The
 * headline swaps by breakpoint to match each mockup 1:1 (mobile: "Money
 * that moves…"; desktop: "Let's set up your wallet." — the desktop rail
 * already carries the "Money that moves…" line, so this component leads
 * with the setup-focused copy on wide screens instead of repeating it).
 */
export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div
      data-testid="welcome-mobile-shell"
      className={cn(
        "flex min-h-svh flex-col gap-6 px-6 pt-[70px] pb-[34px] text-primary-foreground",
        "bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)]",
        "lg:min-h-0 lg:bg-none lg:px-0 lg:pt-0 lg:pb-0 lg:text-foreground"
      )}
    >
      <div className="flex flex-1 flex-col justify-center gap-6 lg:flex-none lg:justify-start">
        <div className="relative h-[66px] w-[66px]">
          <div
            aria-hidden="true"
            className="absolute inset-0 animate-hs-ring rounded-2xl bg-accent opacity-50"
          />
          <BrandMark size={66} className="relative shadow-cta" />
        </div>

        <div>
          <h1 className="text-3xl font-extrabold tracking-tight lg:hidden">
            Money that moves at the speed of chat.
          </h1>
          <h1 className="hidden text-3xl font-extrabold tracking-tight text-foreground lg:block">
            Let&apos;s set up your wallet.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-primary-foreground/80 lg:hidden">
            Buy, send and swap crypto just by talking to your agent. Let&apos;s
            set up your wallet — it takes about a minute.
          </p>
          <p className="mt-3 hidden text-base leading-relaxed text-muted-foreground lg:block">
            Four quick steps — email, a code, your name and a PIN. Then choose
            to verify now or explore first.
          </p>
        </div>
      </div>

      <div>
        <Button
          variant="accent"
          size="lg"
          className="w-full lg:w-auto"
          onClick={onNext}
        >
          Get started
        </Button>
        <p className="mt-4 text-sm text-primary-foreground/70 lg:text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-accent underline underline-offset-2 lg:font-medium lg:text-primary"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
