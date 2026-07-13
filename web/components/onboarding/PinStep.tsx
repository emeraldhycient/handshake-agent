"use client"

import { useImperativeHandle, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { TransactionPinSchema } from "@handshake-agent/contracts/dto"
import { BrandMark } from "@/components/shared/brand-mark"
import { Button } from "@/components/ui/button"
import { useSetPin } from "@/lib/query/kyc"
import { toErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import type { PinConfirmStage, PinStepProps } from "@/types"

// Matches the mockup's 4-digit mobile create/confirm dots (Task FID-B). The
// desktop RHF form below caps at the same length via PIN_INPUT_PROPS.
const PIN_LENGTH = 4

// Reuses the canonical TransactionPinSchema (§8) — the wizard's inputs are
// hard-capped at 4 characters (maxLength=4), so "4 to 6 digits" collapses to
// exactly 4 here while still inheriting the weak-PIN rules (not all the same
// digit, not a simple ascending/descending run) from the one source of truth.
const PinFormSchema = z
  .object({
    pin: TransactionPinSchema,
    confirmPin: z.string(),
  })
  .refine((d) => d.pin === d.confirmPin, {
    message: "Those PINs don't match — try again",
    path: ["confirmPin"],
  })
type PinFormValues = z.infer<typeof PinFormSchema>

const PIN_INPUT_PROPS = {
  type: "password",
  inputMode: "numeric",
  autoComplete: "off",
  maxLength: 4,
} as const

interface PinDotsProps {
  filled: number
  shake: boolean
}

/** Four dots reflecting the entered-digit count — the mobile create/confirm view (Task FID-B). */
function PinDots({ filled, shake }: PinDotsProps) {
  return (
    <div
      className={cn(
        "mt-10 flex justify-center gap-5",
        shake && "animate-hs-shake"
      )}
    >
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-pin-dot
          data-state={i < filled ? "filled" : "empty"}
          className={cn(
            "size-[17px] rounded-full border-2 transition-colors",
            i < filled
              ? "border-accent bg-accent"
              : "border-input bg-transparent"
          )}
        />
      ))}
    </div>
  )
}

/**
 * Step 4 of 4 — set the 4-digit transaction PIN that authorizes every payment.
 *
 * DESKTOP (no `keypadRef` prop): the original single-screen RHF form below
 * with two masked inputs — unchanged, matches the desktop mockup's single
 * PIN screen exactly.
 *
 * MOBILE (`keypadRef` present — Task FID-B): a keypad-driven, two-screen
 * create → confirm flow with 4 dots per screen. The shell's on-screen
 * `Keypad` calls `keypadRef.current.onDigit`/`onBackspace` directly (see
 * `PinStepKeypadHandle`) — every PIN entry state transition (advancing
 * create → confirm, the match check, the `useSetPin` mutation, the
 * shake/mismatch/backend-error presentation) is owned entirely inside this
 * component's own `useState`, driven from those handle methods exactly like
 * a normal event handler, never from a `useEffect` deriving it from props.
 */
export function PinStep({ onNext, onBack, keypadRef }: PinStepProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PinFormValues>({
    resolver: zodResolver(PinFormSchema),
  })

  const setPin = useSetPin()
  const loading = isSubmitting || setPin.isPending

  async function onSubmit(values: PinFormValues) {
    setServerError(null)
    try {
      await setPin.mutateAsync(values.pin)
      onNext()
    } catch (err) {
      setServerError(toErrorMessage(err) ?? "Couldn't set your PIN. Try again.")
      reset({ pin: "", confirmPin: "" })
    }
  }

  // ─── Mobile keypad-driven flow (Task FID-B) ────────────────────────────
  const [stage, setStage] = useState<PinConfirmStage>("create")
  const [createPin, setCreatePin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [mismatch, setMismatch] = useState(false)
  const [mobileError, setMobileError] = useState<string | null>(null)
  const submittedPinRef = useRef<string | null>(null)

  // The handle's methods (and the `submitMobilePin` helper they call) are
  // defined INSIDE the factory so the deps list can name the actual state
  // values they close over — a sibling function would get a new identity
  // every render and defeat the deps array entirely (react-hooks/exhaustive-deps).
  useImperativeHandle(keypadRef, () => {
    async function submitMobilePin(pin: string) {
      setMobileError(null)
      try {
        await setPin.mutateAsync(pin)
        setCreatePin("")
        setConfirmPin("")
        onNext()
      } catch (err) {
        submittedPinRef.current = null
        setMobileError(
          toErrorMessage(err) ?? "Couldn't set your PIN. Try again."
        )
        setStage("create")
        setCreatePin("")
        setConfirmPin("")
      }
    }

    return {
      onDigit(digit: string) {
        if (stage === "create") {
          if (mobileError) setMobileError(null)
          if (createPin.length >= PIN_LENGTH) return
          const next = `${createPin}${digit}`
          setCreatePin(next)
          if (next.length === PIN_LENGTH) setStage("confirm")
          return
        }

        if (mismatch) setMismatch(false)
        if (confirmPin.length >= PIN_LENGTH) return
        const next = `${confirmPin}${digit}`
        setConfirmPin(next)
        if (next.length !== PIN_LENGTH) return

        if (next === createPin) {
          if (submittedPinRef.current !== createPin) {
            submittedPinRef.current = createPin
            void submitMobilePin(createPin)
          }
          return
        }
        setMismatch(true)
        setConfirmPin("")
      },

      onBackspace() {
        if (stage === "create") {
          setCreatePin((prev) => prev.slice(0, -1))
          return
        }
        if (mismatch) setMismatch(false)
        setConfirmPin((prev) => prev.slice(0, -1))
      },

      // The confirm screen's back arrow returns to the create screen
      // rather than leaving the pin step entirely — mirrors the mockup's
      // two-level goBack (confirm → create → name). Returns whether it
      // consumed the tap so the shell knows whether to fall through to
      // its own `machine.back()`.
      handleBack() {
        if (stage !== "confirm") return false
        setStage("create")
        setConfirmPin("")
        setMismatch(false)
        return true
      },
    }
  }, [stage, createPin, confirmPin, mismatch, mobileError, setPin, onNext])

  if (keypadRef) {
    const isCreateStage = stage === "create"
    const heading = isCreateStage
      ? "Create a transaction PIN"
      : "Confirm your PIN"
    const subcopy = isCreateStage
      ? "You'll use this 4-digit PIN to approve every payment."
      : "Enter the same 4 digits once more."
    const stepTag = isCreateStage
      ? "Step 4 of 4 · Set PIN"
      : "Step 4 of 4 · Confirm PIN"
    const filled = isCreateStage ? createPin.length : confirmPin.length

    return (
      <div
        aria-label={`Onboarding — ${stepTag}`}
        className="flex flex-col gap-6"
      >
        <div>
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {stepTag}
            </p>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground">
            {heading}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {subcopy}
          </p>
        </div>

        <PinDots filled={filled} shake={!isCreateStage && mismatch} />

        {isCreateStage ? (
          mobileError ? (
            <p
              role="alert"
              className="text-center text-xs font-semibold text-destructive"
            >
              {mobileError}
            </p>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Never share your PIN. We&apos;ll never ask for it.
            </p>
          )
        ) : (
          <p
            role={mismatch ? "alert" : undefined}
            className={cn(
              "min-h-[18px] text-center text-sm font-semibold",
              mismatch ? "text-destructive" : "text-transparent"
            )}
          >
            {mismatch ? "Those don't match — try again" : ""}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Onboarding — step 4 of 4"
      className="flex flex-col gap-6"
    >
      <div>
        <div className="flex items-center gap-3">
          <BrandMark size={40} className="lg:hidden" />
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="lg:hidden">Step 4 of 4 · Set PIN</span>
            <span className="hidden lg:inline">Step 4 of 4</span>
          </p>
        </div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
          Set your transaction PIN
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">
          You&apos;ll enter this 4-digit PIN to approve every payment.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="onboarding-pin"
          className="text-sm font-semibold text-muted-foreground"
        >
          Create PIN
        </label>
        <input
          id="onboarding-pin"
          aria-invalid={!!errors.pin}
          aria-describedby={errors.pin ? "onboarding-pin-error" : undefined}
          disabled={loading}
          className={`w-full rounded-2xl border-2 bg-card py-4 text-center text-2xl font-extrabold text-foreground shadow-xs focus:outline-none ${
            errors.pin ? "border-destructive" : "border-input"
          }`}
          style={{ letterSpacing: "1rem" }}
          placeholder="••••"
          {...PIN_INPUT_PROPS}
          {...register("pin")}
        />
        {errors.pin && (
          <p
            id="onboarding-pin-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.pin.message}
          </p>
        )}

        <label
          htmlFor="onboarding-confirm-pin"
          className="mt-2 text-sm font-semibold text-muted-foreground"
        >
          Confirm PIN
        </label>
        <input
          id="onboarding-confirm-pin"
          aria-invalid={!!errors.confirmPin}
          aria-describedby={
            errors.confirmPin ? "onboarding-confirm-pin-error" : undefined
          }
          disabled={loading}
          className={`w-full rounded-2xl border-2 bg-card py-4 text-center text-2xl font-extrabold text-foreground shadow-xs focus:outline-none ${
            errors.confirmPin ? "border-destructive" : "border-input"
          }`}
          style={{ letterSpacing: "1rem" }}
          placeholder="••••"
          {...PIN_INPUT_PROPS}
          {...register("confirmPin")}
        />
        {errors.confirmPin && (
          <p
            id="onboarding-confirm-pin-error"
            role="alert"
            className="text-xs font-semibold text-destructive"
          >
            {errors.confirmPin.message}
          </p>
        )}

        {serverError && (
          <p role="alert" className="text-xs font-semibold text-destructive">
            {serverError}
          </p>
        )}
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        Never share your PIN. We&apos;ll never ask for it.
      </p>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={loading}
        >
          Back
        </Button>
        <Button
          type="submit"
          variant="accent"
          size="lg"
          disabled={loading}
          aria-busy={loading}
          className="flex-1"
        >
          {loading ? "Creating…" : "Create account"}
        </Button>
      </div>
    </form>
  )
}
