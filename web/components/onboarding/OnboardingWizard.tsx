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
import { useEffect, useRef, useState } from "react"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import {
  deriveResumeStep,
  useOnboardingMachine,
} from "@/hooks/use-onboarding-machine"
import { useMe } from "@/lib/query/auth"
import { useAuthStore } from "@/lib/store/auth-store"
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
import { SumsubVerificationDialog } from "@/components/kyc/SumsubVerificationDialog"
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
  "done",
])

/**
 * Full-bleed steps whose mockup owns its ENTIRE mobile treatment — a
 * dark-green header band (or, for `welcome`, the whole screen) over a cream
 * body — so the shell must not also impose its own background/padding on
 * top of it (that would show as a cream margin around the component's own
 * edge-to-edge box instead of a true full-bleed screen). The Sumsub flow is
 * no longer a step — it opens in a modal (SumsubVerificationDialog) over the
 * current step.
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
  // Opens the Sumsub verification modal (SumsubVerificationDialog) — wired to
  // the "verify now" affordance on the kyc-choice and done steps.
  onVerifyNow: () => void,
  pinKeypadRef?: { current: PinStepKeypadHandle | null },
  // True on the mobile surface, where the shell renders the on-screen Keypad as
  // the single OTP input — the cells then render read-only (no native keyboard).
  keypadDriven = false
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
          keypadDriven={keypadDriven}
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
          onVerifyNow={onVerifyNow}
          onVerifyLater={() => {
            machine.setData({ kycChoice: "later" })
            machine.goto("done")
          }}
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
          onVerifyNow={onVerifyNow}
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
  /** Opens the Sumsub verification modal (owned by the wizard shell). */
  onVerifyNow: () => void
}

function OnboardingLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  )
}

function DesktopOnboarding({
  machine,
  me,
  onVerifyNow,
}: OnboardingChromeProps) {
  return (
    <div className="grid min-h-svh grid-cols-[400px_1fr] bg-background">
      <OnboardingRail step={machine.step} />
      <div className="flex items-center justify-center overflow-y-auto p-12">
        <div className="w-full max-w-[460px]">
          {renderStep(machine, me, onVerifyNow)}
        </div>
      </div>
    </div>
  )
}

function MobileOnboarding({ machine, me, onVerifyNow }: OnboardingChromeProps) {
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
    return renderStep(machine, me, onVerifyNow)
  }

  if (isFullBleed) {
    return (
      <div className="flex min-h-svh flex-col justify-center bg-background px-6 py-10">
        {renderStep(machine, me, onVerifyNow)}
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col bg-background px-6 pt-14">
      <OnboardingProgress step={machine.step} onBack={onProgressBack} />
      <div className="mt-[26px] flex-1">
        {/* keypadDriven=true: the on-screen Keypad below is the OTP input, so
            the cells render read-only (no competing native keyboard). */}
        {renderStep(machine, me, onVerifyNow, pinKeypadRef, true)}
      </div>
      {showKeypad && (
        <div className="mt-2 pb-[26px]">
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
  const authStatus = useAuthStore((s) => s.status)
  const { data: me, isLoading: meLoading } = useMe()
  const resumedRef = useRef(false)
  // The Sumsub verification opens in a modal over the current step (kyc-choice
  // or the done "verify to unlock" banner) rather than as its own full-screen
  // step, for a more focused experience.
  const [sumsubOpen, setSumsubOpen] = useState(false)

  // The auth store boots 'loading' and rehydrates the access token from the
  // HttpOnly cookie asynchronously (AuthProvider). `useMe` is disabled until a
  // token exists, so during that window it reports isLoading===false with
  // me===undefined — resuming on that would wrongly land a returning user on
  // 'welcome' and then LOCK the one-shot guard, stranding them there even after
  // the real session arrives. So only resume once the session is authoritative:
  // 'anonymous' (genuinely no session → me is null), or 'authenticated' with the
  // /me query resolved. RequireVerified gates on the same signal.
  const sessionResolved =
    authStatus === "anonymous" || (authStatus === "authenticated" && !meLoading)

  useEffect(() => {
    if (resumedRef.current || !sessionResolved) return
    resumedRef.current = true
    machine.goto(deriveResumeStep(me ?? null))
    // `machine`'s action functions (goto/next/back/...) are stable zustand
    // references even though the object itself gets a new identity on every
    // step change — `sessionResolved`/`me` are the only real inputs. This
    // re-runs harmlessly on later changes, but the ref guard above means only
    // the FIRST authoritative session ever moves the step.
  }, [sessionResolved, me, machine])

  // Auth is still rehydrating, or /me is still resolving — show loading rather
  // than resuming on a not-yet-authoritative session (Task F1.4).
  if (!sessionResolved) {
    return <OnboardingLoading />
  }

  // Pre-mount / SSR — avoid a hydration mismatch (mirrors AdaptiveExperience).
  if (isDesktop === null) {
    return <OnboardingLoading />
  }

  const onVerifyNow = () => setSumsubOpen(true)

  return (
    <>
      {isDesktop ? (
        <DesktopOnboarding
          machine={machine}
          me={me}
          onVerifyNow={onVerifyNow}
        />
      ) : (
        <MobileOnboarding machine={machine} me={me} onVerifyNow={onVerifyNow} />
      )}
      <SumsubVerificationDialog
        open={sumsubOpen}
        onOpenChange={setSumsubOpen}
        level="tier_2"
        onSubmitted={() => {
          // The engine grants tier_2 off the signed webhook (root §3.1); this
          // only lets `done` show an honest "in review" state until `me` catches
          // up. The dialog closes itself after this fires.
          machine.setData({ kycSubmitted: true })
          machine.goto("done")
        }}
      />
    </>
  )
}
