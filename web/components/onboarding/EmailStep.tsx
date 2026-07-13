"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { SignupRequestSchema } from "@handshake-agent/contracts/auth"
import { BrandMark } from "@/components/shared/brand-mark"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { useSignupRequest } from "@/lib/query/auth"
import { toErrorMessage } from "@/lib/error-message"
import type { EmailStepProps } from "@/types"

const EmailFormSchema = SignupRequestSchema.pick({ email: true })
type EmailFormValues = { email: string }

/** Step 1 of 4 — collect the email and request a signup OTP. */
export function EmailStep({ data, setData, onNext }: EmailStepProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(EmailFormSchema),
    mode: "onChange",
    defaultValues: { email: data.email ?? "" },
  })

  const signupRequest = useSignupRequest()
  const loading = signupRequest.isPending

  async function onSubmit(values: EmailFormValues) {
    setServerError(null)
    try {
      const result = await signupRequest.mutateAsync(values.email)
      setData({ email: values.email, devOtp: result.devOtp })
      onNext()
    } catch (err) {
      setServerError(toErrorMessage(err) ?? "Something went wrong. Try again.")
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Onboarding — step 1 of 4"
      className="flex flex-col gap-6"
    >
      <div>
        <div className="flex items-center gap-3">
          <BrandMark size={40} className="lg:hidden" />
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="lg:hidden">Step 1 of 4 · Your email</span>
            <span className="hidden lg:inline">Step 1 of 4</span>
          </p>
        </div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
          What&apos;s your email?
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">
          We&apos;ll send a 6-digit code to confirm it&apos;s you.
        </p>
      </div>

      {serverError && <FormAlert>{serverError}</FormAlert>}

      <div
        className={`flex items-center gap-2.5 rounded-2xl border-2 bg-card px-2 py-1 shadow-xs ${
          errors.email ? "border-destructive" : "border-input"
        }`}
      >
        <span
          aria-hidden="true"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-background text-primary"
        >
          <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
            <rect
              x="2"
              y="4"
              width="15"
              height="11"
              rx="2.4"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M2.5 5.5L9.5 10l7-4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <input
          id="onboarding-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@email.com"
          aria-label="Email address"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "onboarding-email-error" : undefined}
          disabled={loading}
          className="min-w-0 flex-1 border-none bg-transparent py-3 text-base font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none"
          {...register("email")}
        />
      </div>
      {errors.email && (
        <p
          id="onboarding-email-error"
          role="alert"
          className="-mt-4 text-xs text-destructive"
        >
          {errors.email.message ?? "Enter a valid email address"}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={!isValid || loading}
        aria-busy={loading}
        className="w-full"
      >
        {loading ? "Sending code…" : "Send code"}
      </Button>

      <p className="text-xs text-muted-foreground">
        We never share your email. No spam, ever.
      </p>
    </form>
  )
}
