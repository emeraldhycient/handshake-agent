"use client"

/**
 * OnboardingWizard — the `/get-started` shell (Task F1.4).
 *
 * Composes the state machine (`useOnboardingMachine`), the seven step
 * components (Task F1.2), and the desktop rail / mobile progress+keypad
 * chrome (Task F1.3) into the working wizard. Pure orchestrator (root
 * CLAUDE.md §16): it wires props, it does not reimplement any step's
 * internals.
 *
 * Resume: on mount it reads `useMe()` and, once resolved, jumps the machine
 * to `deriveResumeStep(me)` exactly once — a brand-new visitor (`me` stays
 * `null`/`undefined`) is left at the machine's default `welcome` step. A
 * `resumedRef` guard means this only ever fires once per mount: later
 * `me` changes (e.g. a step's mutation invalidating the `me` cache) must
 * never yank the user backward after they've already navigated forward.
 */
import { useEffect, useRef } from "react"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import { Button } from "@/components/ui/button"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import {
  deriveResumeStep,
  useOnboardingMachine,
} from "@/hooks/use-onboarding-machine"
import { useMe } from "@/lib/query/auth"
import type { OnboardingMachine, OnboardingStep } from "@/types"
import { WelcomeStep } from "./WelcomeStep"
import { EmailStep } from "./EmailStep"
import { OtpStep } from "./OtpStep"
import { NameStep } from "./NameStep"
import { PinStep } from "./PinStep"
import { KycChoiceStep } from "./KycChoiceStep"
import { DoneStep } from "./DoneStep"
import { Keypad } from "./Keypad"
import { OnboardingProgress } from "./OnboardingProgress"
import { OnboardingRail } from "./OnboardingRail"

// ─── Constants ──────────────────────────────────────────────────────────────

const OTP_LENGTH = 6

/**
 * Steps the mobile on-screen `Keypad` drives. `otp` writes into the
 * machine's shared `data.otp` — a controlled field `OtpStep` re-renders
 * from, so the shell can compute the append/trim itself.
 *
 * `pin` is deliberately excluded: `PinStep` (Task F1.2) keeps its PIN
 * entirely inside an uncontrolled react-hook-form field and never accepts
 * `data`/`setData` — by design, a transaction PIN never lingers in the
 * wizard's shared `data` (see `PinStepProps`'s doc comment). Driving a
 * shell-level Keypad into that field would mean either rewriting PinStep
 * (out of scope — root CLAUDE.md §16, "adapt the shell to the step, don't
 * rewrite the step") or reaching into its internal DOM, which this shell
 * does not do. PinStep's own inputs are `inputMode="numeric"`, which already
 * raises the device numeric keyboard on mobile, so PIN entry is still a
 * numeric-keypad experience — just the OS's, not a custom on-screen one.
 */
const MOBILE_KEYPAD_STEPS: ReadonlySet<OnboardingStep> = new Set(["otp"])

/**
 * Steps that render full-bleed on mobile — no top progress bar, no bottom
 * keypad. These are decision/completion moments (mirrors the mockup), not
 * the four data-collection form steps `OnboardingProgress` tracks.
 */
const MOBILE_FULL_BLEED_STEPS: ReadonlySet<OnboardingStep> = new Set([
  "welcome",
  "kyc",
  "sumsub",
  "done",
])

// ─── Sumsub stub ────────────────────────────────────────────────────────────

interface SumsubStubProps {
  onBack: () => void
}

/**
 * TODO(F3): replace with the real `@sumsub/websdk-react` mount (plan Task
 * F3.1/F3.2) — fetch a token via `useSumsubToken('tier_2')` and render
 * `<SumsubWebSdk accessToken={...} />`, advancing to `done` on
 * `applicantSubmitted`/`applicantReviewed`. Stubbed here (rather than
 * rendering `DoneStep` directly) so the wizard has a distinct, honest
 * "verification is in progress" moment instead of silently pretending the
 * user is already done.
 */
function SumsubStub({ onBack }: SumsubStubProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent"
      />
      <p className="text-base font-semibold text-foreground">
        Loading verification…
      </p>
      <Button type="button" variant="outline" onClick={onBack}>
        Back
      </Button>
    </div>
  )
}

// ─── Step dispatch ──────────────────────────────────────────────────────────

function renderStep(
  machine: OnboardingMachine,
  me: MeResponse | null | undefined
) {
  const firstName = machine.data.firstName ?? me?.firstName ?? undefined

  switch (machine.step) {
    case "welcome":
      return <WelcomeStep onNext={machine.next} />
    case "email":
      return (
        <EmailStep
          data={machine.data}
          setData={machine.setData}
          onNext={machine.next}
        />
      )
    case "otp":
      return (
        <OtpStep
          data={machine.data}
          setData={machine.setData}
          onNext={machine.next}
          onBack={machine.back}
        />
      )
    case "name":
      return (
        <NameStep
          data={machine.data}
          setData={machine.setData}
          onNext={machine.next}
          onBack={machine.back}
        />
      )
    case "pin":
      return <PinStep onNext={machine.next} onBack={machine.back} />
    case "kyc":
      return (
        <KycChoiceStep
          firstName={firstName}
          onVerifyNow={() => machine.goto("sumsub")}
          onVerifyLater={() => {
            machine.setData({ kycChoice: "later" })
            machine.goto("done")
          }}
        />
      )
    case "sumsub":
      return <SumsubStub onBack={machine.back} />
    case "done":
      return (
        <DoneStep
          firstName={firstName}
          kycStatus={me?.kycStatus}
          skipped={machine.data.kycChoice === "later"}
          onVerifyNow={() => machine.goto("sumsub")}
        />
      )
    default:
      return null
  }
}

// ─── Chrome ─────────────────────────────────────────────────────────────────

interface OnboardingChromeProps {
  machine: OnboardingMachine
  me: MeResponse | null | undefined
}

function OnboardingLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  )
}

function DesktopOnboarding({ machine, me }: OnboardingChromeProps) {
  return (
    <div className="grid min-h-svh grid-cols-[440px_1fr] bg-background">
      <OnboardingRail step={machine.step} />
      <div className="flex items-center justify-center overflow-y-auto px-16 py-12">
        <div className="w-full max-w-md">{renderStep(machine, me)}</div>
      </div>
    </div>
  )
}

function MobileOnboarding({ machine, me }: OnboardingChromeProps) {
  const isFullBleed = MOBILE_FULL_BLEED_STEPS.has(machine.step)
  const showKeypad = MOBILE_KEYPAD_STEPS.has(machine.step)

  function onOtpDigit(digit: string) {
    const next = `${machine.data.otp ?? ""}${digit}`.slice(0, OTP_LENGTH)
    machine.setData({ otp: next })
  }

  function onOtpBackspace() {
    machine.setData({ otp: (machine.data.otp ?? "").slice(0, -1) })
  }

  if (isFullBleed) {
    return (
      <div className="flex min-h-svh flex-col justify-center bg-background px-6 py-10">
        {renderStep(machine, me)}
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col bg-background px-6 py-6">
      <OnboardingProgress step={machine.step} onBack={machine.back} />
      <div className="mt-8 flex-1">{renderStep(machine, me)}</div>
      {showKeypad && (
        <div className="mt-6 pb-2">
          <Keypad onDigit={onOtpDigit} onBackspace={onOtpBackspace} />
        </div>
      )}
    </div>
  )
}

// ─── Shell ──────────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const isDesktop = useIsDesktop()
  const machine = useOnboardingMachine()
  const { data: me, isLoading: meLoading } = useMe()
  const resumedRef = useRef(false)

  useEffect(() => {
    if (resumedRef.current || meLoading) return
    resumedRef.current = true
    machine.goto(deriveResumeStep(me ?? null))
    // `machine`'s action functions (goto/next/back/...) are stable zustand
    // references even though the object itself gets a new identity on every
    // step change — `me`/`meLoading` are the only real inputs. This re-runs
    // harmlessly on later `me`/`machine` changes, but the ref guard above
    // means only the FIRST resolved value ever moves the step.
  }, [meLoading, me, machine])

  // /me is still resolving (Task F1.4: handle the me-query loading branch).
  if (meLoading) {
    return <OnboardingLoading />
  }

  // Pre-mount / SSR — avoid a hydration mismatch (mirrors AdaptiveExperience).
  if (isDesktop === null) {
    return <OnboardingLoading />
  }

  return isDesktop ? (
    <DesktopOnboarding machine={machine} me={me} />
  ) : (
    <MobileOnboarding machine={machine} me={me} />
  )
}
