"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { TransactionPinSchema } from "@handshake-agent/contracts/dto"
import { Button } from "@/components/ui/button"
import { useSetPin } from "@/lib/query/kyc"
import { toErrorMessage } from "@/lib/error-message"
import type { PinStepProps } from "@/types"

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

/** Step 4 of 4 — set the 4-digit transaction PIN that authorizes every payment. */
export function PinStep({ onNext, onBack }: PinStepProps) {
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

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Onboarding — step 4 of 4"
      className="flex flex-col gap-6"
    >
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Step 4 of 4
        </p>
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
