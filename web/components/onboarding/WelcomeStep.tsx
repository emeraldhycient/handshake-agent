"use client"

import Link from "next/link"
import { BrandMark } from "@/components/shared/brand-mark"
import { Button } from "@/components/ui/button"
import type { WelcomeStepProps } from "@/types"

/**
 * First screen of the onboarding wizard. Chrome-agnostic content: the mobile
 * chrome renders this full-screen, the desktop chrome renders it inside the
 * right panel next to the brand rail (Task F1.3/F1.4). The headline swaps by
 * breakpoint to match each mockup 1:1 (mobile: "Money that moves…"; desktop:
 * "Let's set up your wallet." — the desktop rail already carries the "Money
 * that moves…" line, so this component leads with the setup-focused copy on
 * wide screens instead of repeating it).
 */
export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="relative h-[66px] w-[66px]">
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-hs-ring rounded-2xl bg-accent opacity-50"
        />
        <BrandMark size={66} className="relative shadow-cta" />
      </div>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground lg:hidden">
          Money that moves at the speed of chat.
        </h1>
        <h1 className="hidden text-3xl font-extrabold tracking-tight text-foreground lg:block">
          Let&apos;s set up your wallet.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground lg:hidden">
          Buy, send and swap crypto just by talking to your agent. Let&apos;s
          set up your wallet — it takes about a minute.
        </p>
        <p className="mt-3 hidden text-base leading-relaxed text-muted-foreground lg:block">
          Four quick steps — email, a code, your name and a PIN. Then choose to
          verify now or explore first.
        </p>
      </div>

      <div>
        <Button size="lg" className="w-full lg:w-auto" onClick={onNext}>
          Get started
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline underline-offset-2"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
