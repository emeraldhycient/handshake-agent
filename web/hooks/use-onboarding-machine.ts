/**
 * The `/get-started` onboarding wizard state machine.
 *
 * A session is only ever issued at signup/verify (which grants tier_1 +
 * emailVerified in the same request — see `docs/superpowers/specs/
 * 2026-07-13-onboarding-redesign-design.md` §3.1), so in practice
 * `session ⇒ emailVerified`. `deriveResumeStep` still checks `emailVerified`
 * explicitly rather than assuming it, so a reload resumes correctly even if
 * that invariant ever changes server-side.
 *
 * The machine itself is a per-mount Zustand vanilla store (not a module
 * singleton like `useAuthStore`/`useChatStore` — the wizard is a single
 * instance in the tree, so each `useOnboardingMachine()` call gets an
 * isolated store instead of sharing global mutable state, which also keeps
 * tests trivially isolated).
 */

import { useState } from "react"
import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import type { OnboardingData, OnboardingMachine, OnboardingStep } from "@/types"
import { ONBOARDING_STEP_ORDER } from "@/constants/onboarding"

const EMPTY_DATA: OnboardingData = {}

/**
 * Pure resume derivation from `GET /auth/me`. No session data is read from
 * anywhere else — this is the single source of truth for "where does a
 * reloading user land."
 *
 * - no session (`me === null`) → `welcome`
 * - session + email not yet verified → `otp`
 * - verified + no name on file → `name`
 * - named + no PIN set → `pin`
 * - PIN set + a Sumsub review already in flight (`kycStatus === 'pending_review'`) → `done`
 *   (DoneStep renders the honest "In review" state; do NOT re-offer the choice fork)
 * - PIN set + still tier_1, verification not started → `kyc` (the choice step)
 * - PIN set + tier_2/tier_3 (already identity-verified) → `done`
 */
export function deriveResumeStep(me: MeResponse | null): OnboardingStep {
  if (!me) return "welcome"
  if (!me.emailVerified) return "otp"
  if (!me.firstName) return "name"
  if (!me.hasPin) return "pin"
  // A submitted-but-not-yet-graded Sumsub review keeps kycTier at tier_1 while
  // the webhook grants tier_2 asynchronously (root §3.1). Resume on `done` (the
  // in-review confirmation) rather than dropping the user back onto the
  // verify-now/later fork as if they never submitted.
  if (me.kycStatus === "pending_review") return "done"
  if (me.kycTier === "tier_1") return "kyc"
  return "done"
}

/**
 * `sumsub` is deliberately excluded from `ONBOARDING_STEP_ORDER` (root
 * CLAUDE.md §16 — it is reached only via an explicit `goto` from `kyc`, the
 * "verify now" choice). It still needs a sane place in `next()`/`back()` so a
 * step component can call the same generic controls: back returns to the
 * `kyc` choice screen it came from, next proceeds to `done` (Sumsub itself
 * calls `goto("done")` on completion — `next()` from `sumsub` is the same
 * "move on" affordance for a cancel/skip path).
 */
function stepAfter(step: OnboardingStep): OnboardingStep {
  if (step === "sumsub") return "done"
  const index = ONBOARDING_STEP_ORDER.indexOf(step)
  if (index === -1 || index === ONBOARDING_STEP_ORDER.length - 1) return step
  return ONBOARDING_STEP_ORDER[index + 1]
}

function stepBefore(step: OnboardingStep): OnboardingStep {
  if (step === "sumsub") return "kyc"
  const index = ONBOARDING_STEP_ORDER.indexOf(step)
  if (index <= 0) return ONBOARDING_STEP_ORDER[0]
  return ONBOARDING_STEP_ORDER[index - 1]
}

function createOnboardingMachineStore(initialStep: OnboardingStep) {
  return createStore<OnboardingMachine>()((set, get) => ({
    step: initialStep,
    data: EMPTY_DATA,

    setData(patch) {
      set((s) => ({ data: { ...s.data, ...patch } }))
    },

    next() {
      set({ step: stepAfter(get().step) })
    },

    back() {
      set({ step: stepBefore(get().step) })
    },

    goto(step) {
      set({ step })
    },

    restart() {
      set({ step: "welcome", data: EMPTY_DATA })
    },
  }))
}

/**
 * `useOnboardingMachine(initialStep?)` — the wizard's step + in-flight data,
 * plus the transition actions. `initialStep` seeds the machine (e.g. from
 * `deriveResumeStep(me)` on mount); it is read once, at first render, and is
 * not re-applied on subsequent prop changes — `goto`/`restart` are the
 * explicit ways to move the step afterward.
 */
export function useOnboardingMachine(
  initialStep: OnboardingStep = "welcome"
): OnboardingMachine {
  const [store] = useState(() => createOnboardingMachineStore(initialStep))
  return useStore(store)
}
