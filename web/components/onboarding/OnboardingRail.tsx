"use client"

import { BrandMark } from "@/components/shared/brand-mark"
import { cn } from "@/lib/utils"
import {
  ONBOARDING_STEP_TRACKER,
  getOnboardingStageIndex,
} from "@/constants/onboarding"
import type { OnboardingRailProps } from "@/types"

type TrackerRowState = "done" | "active" | "pending"

function trackerRowState(index: number, stageIndex: number): TrackerRowState {
  if (index < stageIndex) return "done"
  if (index === stageIndex) return "active"
  return "pending"
}

/**
 * The desktop left brand rail (Task F1.3): logo + wordmark, the "Money that
 * moves…" headline, the vertical step-tracker for the 4 core stages, and the
 * encryption/compliance footer. Pure chrome — the wizard shell (Task F1.4)
 * mounts this alongside the current step's content and never renders it on
 * its own on mobile.
 */
export function OnboardingRail({ step }: OnboardingRailProps) {
  const stageIndex = getOnboardingStageIndex(step)

  return (
    <div className="flex h-full w-full flex-col bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)] px-10 py-11 text-primary-foreground">
      <div className="flex items-center gap-2.5">
        <BrandMark size={40} />
        <span className="text-[17px] font-bold tracking-tight">Handshake</span>
      </div>

      <div className="flex flex-1 flex-col justify-center py-6">
        <h2 className="text-[32px] leading-[1.08] font-extrabold tracking-tight">
          Money that moves at the speed of chat.
        </h2>
        <p className="mt-3.5 max-w-[290px] text-sm leading-relaxed text-primary-foreground/80">
          Buy, send and swap crypto just by talking to your agent. Setup takes
          about a minute.
        </p>
      </div>

      <div className="flex flex-col gap-0.5">
        {ONBOARDING_STEP_TRACKER.map((item, index) => {
          const state = trackerRowState(index, stageIndex)
          return (
            <div
              key={item.step}
              data-onboarding-tracker-row
              data-state={state}
              className="flex items-center gap-3.5 py-2.5"
            >
              <span
                className={cn(
                  "flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border-2 font-mono text-[13px] font-extrabold",
                  state === "done" &&
                    "border-accent bg-accent text-primary-deep",
                  state === "active" &&
                    "border-accent bg-accent/15 text-accent",
                  state === "pending" &&
                    "border-primary-foreground/25 bg-transparent text-primary-foreground/50"
                )}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              <span
                className={cn(
                  "flex-1 text-[14.5px] font-bold",
                  state === "pending"
                    ? "text-primary-foreground/55"
                    : "text-primary-foreground"
                )}
              >
                {item.label}
              </span>
              {state !== "pending" && (
                <span
                  className={cn(
                    "text-xs font-semibold",
                    state === "done" ? "text-success-bright" : "text-accent"
                  )}
                >
                  {state === "done" ? "Done" : "Now"}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 flex items-center gap-2 text-primary-foreground/60">
        <svg
          width="14"
          height="15"
          viewBox="0 0 14 15"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 7V5a3.5 3.5 0 017 0v2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <rect
            x="1.8"
            y="7"
            width="10.4"
            height="6.5"
            rx="2"
            fill="currentColor"
          />
        </svg>
        <span className="text-xs">
          256-bit encryption · NDPR &amp; CBN compliant
        </span>
      </div>
    </div>
  )
}
