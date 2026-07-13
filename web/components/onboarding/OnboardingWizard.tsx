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
import { useIsDesktop } from "@/hooks/use-is-desktop"
import {
  deriveResumeStep,
  useOnboardingMachine,
} from "@/hooks/use-onboarding-machine"
import { useMe } from "@/lib/query/auth"
import type {
  OnboardingMachine,
  OnboardingStep,
  PinStepKeypadHandle,
} from "@/types"
import { WelcomeStep } from "./WelcomeStep"
import { EmailStep } from "./EmailStep"
import { OtpStep } from "./OtpStep"
import { NameStep } from "./NameStep"
import { PinStep } from "./PinStep"
import { KycChoiceStep } from "./KycChoiceStep"
import { DoneStep } from "./DoneStep"
import { SumsubVerification } from "@/components/kyc/SumsubVerification"
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
 * `pin` (Task FID-B) routes taps directly to `PinStep` via an imperative
 * `PinStepKeypadHandle` ref (see that type's doc comment) — `PinStep` owns
 * its own PIN entry state entirely, so this shell holds no PIN digit state
 * at all, just the ref used to reach it.
 */
const MOBILE_KEYPAD_STEPS: ReadonlySet<OnboardingStep> = new Set(["otp", "pin"])

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

/**
 * Full-bleed steps whose mockup owns its ENTIRE mobile treatment — a
 * dark-green header band (or, for `welcome`, the whole screen) over a cream
 * body — so the shell must not also impose its own background/padding on
 * top of it (that would show as a cream margin around the component's own
 * edge-to-edge box instead of a true full-bleed screen). `sumsub` stays in
 * the shell's plain centered/padded box: it mounts the Sumsub WebSDK iframe
 * (F3.2), which manages its own internal layout.
 */
const MOBILE_EDGE_TO_EDGE_STEPS: ReadonlySet<OnboardingStep> = new Set([
  "welcome",
  "kyc",
  "done",
])

// ─── Step dispatch ──────────────────────────────────────────────────────────

function renderStep(
  machine: OnboardingMachine,
  me: MeResponse | null | undefined,
  pinKeypadRef?: { current: PinStepKeypadHandle | null }
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
      return (
        <PinStep
          onNext={machine.next}
          onBack={machine.back}
          keypadRef={pinKeypadRef}
        />
      )
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
      return (
        <SumsubVerification
          level="tier_2"
          onSubmitted={() => {
            // The engine grants tier_2 off the signed webhook (root §3.1);
            // this only lets `done` show an honest "in review" state until
            // `me` catches up.
            machine.setData({ kycSubmitted: true })
            machine.goto("done")
          }}
          onBack={machine.back}
        />
      )
    case "done":
      return (
        <DoneStep
          firstName={firstName}
          kycStatus={
            machine.data.kycSubmitted ? "pending_review" : me?.kycStatus
          }
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
  const isEdgeToEdge = MOBILE_EDGE_TO_EDGE_STEPS.has(machine.step)
  const showKeypad = MOBILE_KEYPAD_STEPS.has(machine.step)

  // Task FID-B: `PinStep` owns its own PIN entry state entirely (see
  // `PinStepKeypadHandle`'s doc comment) — this shell holds no PIN digit
  // state, just the ref used to route `Keypad` taps into it.
  const pinKeypadRef = useRef<PinStepKeypadHandle>(null)

  function onOtpDigit(digit: string) {
    const next = `${machine.data.otp ?? ""}${digit}`.slice(0, OTP_LENGTH)
    machine.setData({ otp: next })
  }

  function onOtpBackspace() {
    machine.setData({ otp: (machine.data.otp ?? "").slice(0, -1) })
  }

  function onKeypadDigit(digit: string) {
    if (machine.step === "otp") onOtpDigit(digit)
    else if (machine.step === "pin") pinKeypadRef.current?.onDigit(digit)
  }

  function onKeypadBackspace() {
    if (machine.step === "otp") onOtpBackspace()
    else if (machine.step === "pin") pinKeypadRef.current?.onBackspace()
  }

  // On the pin step, PinStep's own back arrow first returns confirm → create
  // internally (see `PinStepKeypadHandle.handleBack`); only when it reports
  // it didn't consume the tap (already on the create screen) does the shell
  // fall through to its normal `machine.back()`.
  function onProgressBack() {
    if (machine.step === "pin" && pinKeypadRef.current?.handleBack()) return
    machine.back()
  }

  // welcome/kyc/done: the step component owns its full mobile treatment
  // (dark-green band + cream body) — no shell wrapper on top of it.
  if (isEdgeToEdge) {
    return renderStep(machine, me)
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
      <OnboardingProgress step={machine.step} onBack={onProgressBack} />
      <div className="mt-8 flex-1">{renderStep(machine, me, pinKeypadRef)}</div>
      {showKeypad && (
        <div className="mt-6 pb-2">
          <Keypad onDigit={onKeypadDigit} onBackspace={onKeypadBackspace} />
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
