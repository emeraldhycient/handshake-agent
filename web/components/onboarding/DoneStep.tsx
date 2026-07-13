"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/shared/status-pill"
import { formatFiat } from "@/lib/format"
import type { DoneStepProps } from "@/types"
import type { StatusTone } from "@/lib/schemas"

function statusBadge(kycStatus?: string): { label: string; tone: StatusTone } {
  if (kycStatus === "verified") return { label: "Verified", tone: "success" }
  if (kycStatus === "pending_review")
    return { label: "In review", tone: "warn" }
  return { label: "Unverified", tone: "neutral" }
}

/** Final screen — the wallet is live; verify now (if skipped) or open the app. */
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
    <div className="flex flex-col gap-6">
      <div className="relative h-16 w-16">
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

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
          Welcome to Handshake{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">
          {subcopy}
        </p>
      </div>

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
            <p className="text-sm font-bold text-warn-foreground">
              Verify to unlock sending &amp; cash-out
            </p>
            <p className="mt-0.5 text-xs text-warn-foreground/80">
              Takes about a minute.
            </p>
          </div>
          <Button
            type="button"
            onClick={onVerifyNow}
            className="mt-3 w-full bg-primary-deep text-primary-foreground hover:bg-primary-deep/90"
          >
            Verify now
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

      <Button size="lg" className="w-full" onClick={() => router.push("/")}>
        Open my wallet
      </Button>
    </div>
  )
}
