"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { BrandMark } from "@/components/shared/brand-mark"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { useSetName } from "@/lib/query/kyc-onboarding"
import { toErrorMessage } from "@/lib/error-message"
import type { NameStepProps } from "@/types"

const NameFormSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name"),
})
type NameFormValues = z.infer<typeof NameFormSchema>

/**
 * Splits a free-typed full name into `{firstName, lastName}` for the
 * `SetNameRequest` contract (both fields required, min 1 char each). A
 * single-word entry duplicates it into lastName rather than blocking
 * submission — the legal name is captured properly later during Sumsub KYC;
 * this is only the display name shown across the app pre-verification.
 */
function splitFullName(fullName: string): {
  firstName: string
  lastName: string
} {
  const parts = fullName.trim().replace(/\s+/g, " ").split(" ")
  const firstName = parts[0]
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : parts[0]
  return { firstName, lastName }
}

/** Step 3 of 4 — collect the display name shown across the app. */
export function NameStep({ data, setData, onNext, onBack }: NameStepProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const defaultFullName = [data.firstName, data.lastName]
    .filter(Boolean)
    .join(" ")
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<NameFormValues>({
    resolver: zodResolver(NameFormSchema),
    mode: "onChange",
    defaultValues: { fullName: defaultFullName },
  })

  const setName = useSetName()
  const loading = setName.isPending

  async function onSubmit(values: NameFormValues) {
    setServerError(null)
    const { firstName, lastName } = splitFullName(values.fullName)
    try {
      await setName.mutateAsync({ firstName, lastName })
      setData({ firstName, lastName })
      onNext()
    } catch (err) {
      setServerError(
        toErrorMessage(err) ?? "Couldn't save your name. Try again."
      )
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Onboarding — step 3 of 4"
      className="flex flex-col gap-6"
    >
      <div>
        <div className="flex items-center gap-3">
          <BrandMark size={40} className="lg:hidden" />
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="lg:hidden">Step 3 of 4 · Your name</span>
            <span className="hidden lg:inline">Step 3 of 4</span>
          </p>
        </div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
          What should we call you?
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">
          Use the name on your ID — it speeds up verification later.
        </p>
      </div>

      {serverError && <FormAlert>{serverError}</FormAlert>}

      <div
        className={`flex items-center gap-2.5 rounded-2xl border-2 bg-card px-2 py-1 shadow-xs ${
          errors.fullName ? "border-destructive" : "border-input"
        }`}
      >
        <span
          aria-hidden="true"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-background text-primary"
        >
          <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
            <circle
              cx="9.5"
              cy="6"
              r="3.1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M3.5 15.5c0-3 2.7-5 6-5s6 2 6 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <input
          id="onboarding-full-name"
          type="text"
          autoComplete="name"
          placeholder="Full name"
          aria-label="Full name"
          aria-invalid={!!errors.fullName}
          aria-describedby={
            errors.fullName ? "onboarding-full-name-error" : undefined
          }
          disabled={loading}
          className="min-w-0 flex-1 border-none bg-transparent py-3 text-base font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none"
          {...register("fullName")}
        />
      </div>
      {errors.fullName && (
        <p
          id="onboarding-full-name-error"
          role="alert"
          className="-mt-4 text-xs text-destructive"
        >
          {errors.fullName.message}
        </p>
      )}

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
          disabled={!isValid || loading}
          aria-busy={loading}
          className="flex-1"
        >
          {loading ? "Saving…" : "Continue"}
        </Button>
      </div>
    </form>
  )
}
