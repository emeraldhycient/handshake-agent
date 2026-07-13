/**
 * The `/get-started` onboarding wizard: welcome → email → otp → name → pin →
 * kyc-choice → [sumsub] → done. `sumsub` is reachable only via an explicit
 * `goto` from `kyc` (the "verify now" choice) — it never sits in the linear
 * next/back order (root CLAUDE.md §16; plan `2026-07-13-onboarding-frontend.md`
 * Task F1.1).
 */
export type OnboardingStep =
  | "welcome"
  | "email"
  | "otp"
  | "name"
  | "pin"
  | "kyc"
  | "sumsub"
  | "done"

/** The "verify now" vs "explore first" choice on the `kyc` step. */
export type OnboardingKycChoice = "now" | "later"

/**
 * In-flight wizard fields collected across steps. Client-only UI state — the
 * server-side session (email verification, name, PIN, KYC tier) is the
 * source of truth once each step's API call succeeds; this just carries the
 * form values between steps within a single wizard run.
 */
export interface OnboardingData {
  email?: string
  otp?: string
  /** Dev-mode OTP echo (AUTH_DEV_EXPOSE_OTP) — prefills the otp step in non-prod. */
  devOtp?: string
  firstName?: string
  lastName?: string
  kycChoice?: OnboardingKycChoice
  /**
   * Set once the user submits the Sumsub flow in-wizard (F3.2). The tier is
   * still granted server-side off the webhook (root §3.1) — this only lets the
   * final `done` step show an honest "in review" state before `me` catches up.
   */
  kycSubmitted?: boolean
}

/** Return shape of `useOnboardingMachine`. */
export interface OnboardingMachine {
  step: OnboardingStep
  data: OnboardingData
  setData(patch: Partial<OnboardingData>): void
  /** Advance along the linear step order. No-op at the last step. */
  next(): void
  /** Reverse along the linear step order. No-op at the first step. */
  back(): void
  /** Jump directly to a step (used for the kyc → sumsub branch). */
  goto(step: OnboardingStep): void
  /** Reset to `welcome` with empty wizard data. */
  restart(): void
}

/** One entry in the desktop rail's vertical step-tracker. */
export interface OnboardingTrackerItem {
  step: OnboardingStep
  label: string
}

// ─── Step component props (Task F1.2) ──────────────────────────────────────
// Each step is presentational + testable in isolation: it reads/writes wizard
// fields via `data`/`setData` and advances via `onNext`/`onBack`/`onGoto`-style
// callbacks passed down by the wizard shell (Task F1.4), rather than consuming
// `useOnboardingMachine()` itself.

export interface WelcomeStepProps {
  /** Advance to the `email` step. */
  onNext: () => void
}

export interface EmailStepProps {
  data: OnboardingData
  setData: (patch: Partial<OnboardingData>) => void
  /** Advance to the `otp` step once the code has been sent. */
  onNext: () => void
}

export interface OtpStepProps {
  data: OnboardingData
  setData: (patch: Partial<OnboardingData>) => void
  /** Advance to the `name` step once the code is verified. */
  onNext: () => void
  /** Return to the `email` step. */
  onBack: () => void
  /**
   * True on the mobile surface, where the shell renders the on-screen `Keypad`
   * as the single input for the code. The cells then render read-only with
   * `inputMode="none"` so tapping a cell does NOT summon the native keyboard
   * over the custom keypad (two competing input surfaces). Desktop leaves this
   * false: the cells are editable and support typing, paste, autofill, and
   * mount autofocus.
   */
  keypadDriven?: boolean
}

export interface NameStepProps {
  data: OnboardingData
  setData: (patch: Partial<OnboardingData>) => void
  /** Advance to the `pin` step once the name is saved. */
  onNext: () => void
  /** Return to the `otp` step. */
  onBack: () => void
}

/** The two mobile-only PIN entry screens (Task FID-B) — create, then confirm. */
export type PinConfirmStage = "create" | "confirm"

/**
 * Imperative handle for the mobile keypad-driven PIN flow (Task FID-B). The
 * shell's on-screen `Keypad` calls these methods directly — via a plain ref
 * PROP (`PinStepProps.keypadRef`), not React's reserved `ref` — so `PinStep`
 * can own its entire PIN-entry state (stage, digit buffers, mismatch)
 * internally via its own `useState`, exactly like the desktop RHF form does.
 * This keeps state transitions inside real event-handler call sites (a
 * `Keypad` tap → `onDigit`) rather than a `useEffect` deriving them from
 * props, and means a transaction PIN never lingers in the wizard's shared,
 * persisted `OnboardingData` — it lives only inside `PinStep`, cleared the
 * moment the mutation that consumes it settles.
 */
export interface PinStepKeypadHandle {
  /** Routes a tapped digit ("0"–"9") into whichever screen is active. */
  onDigit: (digit: string) => void
  /** Routes a backspace tap into whichever screen is active. */
  onBackspace: () => void
  /**
   * Called when the shell's top-bar back arrow is pressed while on the
   * `pin` step. Returns `true` if `PinStep` handled it internally (confirm
   * screen → create screen); `false` means the shell should fall through to
   * its normal `machine.back()`.
   */
  handleBack: () => boolean
}

export interface PinStepProps {
  /**
   * Advance to the `kyc` choice step once the PIN is set. The PIN itself is
   * kept local to this step (never lifted into the wizard's shared `data`) —
   * there is no reason for a transaction PIN to linger in memory past the
   * mutation that consumes it.
   */
  onNext: () => void
  /** Return to the `name` step. */
  onBack: () => void
  /**
   * Present ONLY on mobile (Task FID-B) — a ref object the shell attaches so
   * its on-screen `Keypad` can route taps into this step's own internal PIN
   * entry state. Passing this ref is what selects the keypad-driven
   * two-screen dots view instead of the desktop RHF form. See
   * `PinStepKeypadHandle`.
   */
  keypadRef?: { current: PinStepKeypadHandle | null }
}

export interface KycChoiceStepProps {
  firstName?: string | null
  /** "Verify now" — the wizard shell wires this to `goto('sumsub')`. */
  onVerifyNow: () => void
  /** "Explore first, verify later" — wired to `setData({kycChoice:'later'})` + `goto('done')`. */
  onVerifyLater: () => void
}

export interface DoneStepProps {
  firstName?: string | null
  /** From `MeResponse.kycStatus` — drives the status badge + subcopy. */
  kycStatus?: string
  /** True when the user picked "explore first, verify later" on the kyc-choice step. */
  skipped: boolean
  /** Launches Sumsub verification from the "Verify to unlock" banner. */
  onVerifyNow: () => void
}

// ─── Chrome component props (Task F1.3) ────────────────────────────────────
// Keypad/OnboardingProgress/OnboardingRail are the mobile on-screen keypad,
// mobile top bar, and desktop brand rail respectively — pure chrome, wired
// into the wizard shell by Task F1.4.

export interface KeypadProps {
  /** Called with the tapped digit ("0"–"9"). */
  onDigit: (digit: string) => void
  /** Called when the backspace (⌫) key is tapped. */
  onBackspace: () => void
  disabled?: boolean
}

export interface OnboardingProgressProps {
  /** Current wizard step — derives which of the 4 core-stage segments are done/active/pending. */
  step: OnboardingStep
  /** Navigates to the previous step. */
  onBack: () => void
}

export interface OnboardingRailProps {
  /** Current wizard step — drives the vertical step-tracker's done/active/pending rows. */
  step: OnboardingStep
}
