"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ONBOARDING_STEP_TRACKER,
  getOnboardingStageIndex,
} from "@/constants/onboarding"
import type { OnboardingProgressProps } from "@/types"

/**
 * The mobile top bar (Task F1.3): a back button plus the 4-segment progress
 * bar for the core email/otp/name/pin stages. Segment state is derived from
 * `step` via `getOnboardingStageIndex` — the same mapping `OnboardingRail`
 * uses for its vertical tracker, so mobile and desktop never disagree about
 * where the user is.
 */
export function OnboardingProgress({ step, onBack }: OnboardingProgressProps) {
  const stageIndex = getOnboardingStageIndex(step)

  return (
    <div className="flex items-center gap-3.5">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onBack}
        aria-label="Back"
        className="size-[38px] flex-none rounded-[12px]"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 17 17"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10.5 3.5L5.5 8.5l5 5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Button>

      <div
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={0}
        aria-valuemax={ONBOARDING_STEP_TRACKER.length}
        aria-valuenow={Math.max(stageIndex, 0)}
        className="flex flex-1 gap-1.5"
      >
        {ONBOARDING_STEP_TRACKER.map((item, index) => {
          const state =
            index < stageIndex
              ? "done"
              : index === stageIndex
                ? "active"
                : "pending"
          return (
            <div
              key={item.step}
              data-onboarding-segment
              data-state={state}
              className={cn(
                "h-[5px] flex-1 rounded-[3px]",
                state === "done" && "bg-primary",
                state === "active" && "bg-accent",
                state === "pending" && "bg-border"
              )}
            />
          )
        })}
      </div>
    </div>
  )
}
