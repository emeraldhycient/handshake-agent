"use client"

/**
 * SignupForm — feature component for the /signup page.
 *
 * Collects email + phone, submits via useSignup() hook.
 * On success (without devToken): shows "Check your email" confirmation.
 * On success (with devToken): also shows a dev-only verify link.
 *
 * Strict layering: pure UI — no fetch, no axios, no business logic.
 */
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  SignupRequestSchema,
  type SignupRequest,
} from "@handshake-agent/contracts/auth"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSignup } from "@/lib/query/auth"
import type { SignupFormProps } from "@/types/components"

export function SignupForm({ className }: SignupFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequest>({
    resolver: zodResolver(SignupRequestSchema),
  })

  const { mutateAsync, isPending, isSuccess, error, data } = useSignup()

  const loading = isSubmitting || isPending

  async function onSubmit(values: SignupRequest) {
    try {
      await mutateAsync(values)
    } catch {
      // Error surfaces via mutation.error — rendered below. Never silently drop.
    }
  }

  // ─── Success state ──────────────────────────────────────────────────────────

  if (isSuccess) {
    const devToken = data?.devToken

    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-4 rounded-xl border border-success bg-success/10 px-6 py-10 text-center"
      >
        <span className="text-4xl" aria-hidden="true">
          ✉
        </span>
        <h2 className="text-lg font-semibold text-foreground">
          Check your email
        </h2>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to your email address. Click it to
          activate your account.
        </p>

        {devToken && (
          <div className="mt-4 w-full rounded-lg border-2 border-warn bg-warn/10 px-4 py-3 text-left">
            <p className="mb-2 text-xs font-semibold tracking-wide text-warn-foreground uppercase">
              Dev only
            </p>
            <Link
              href={`/verify-email?token=${devToken}`}
              className="text-sm font-medium text-primary underline underline-offset-2"
            >
              Dev: click to verify email
            </Link>
          </div>
        )}
      </div>
    )
  }

  // ─── Form state (loading / error / empty) ──────────────────────────────────

  const serverError =
    error instanceof Error ? error.message : error ? String(error) : null

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Create account form"
      className={`flex flex-col gap-5 ${className ?? ""}`}
    >
      {/* Server error — surfaced, never swallowed */}
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      )}

      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="signup-email"
          className="text-sm font-medium text-foreground"
        >
          Email address
        </label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          aria-required="true"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "signup-email-error" : undefined}
          placeholder="you@example.com"
          disabled={loading}
          {...register("email")}
        />
        {errors.email && (
          <p
            id="signup-email-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.email.message ?? "Enter a valid email address"}
          </p>
        )}
      </div>

      {/* Phone */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="signup-phone"
          className="text-sm font-medium text-foreground"
        >
          Phone number
        </label>
        <Input
          id="signup-phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          aria-required="true"
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? "signup-phone-error" : undefined}
          placeholder="+2348012345678"
          disabled={loading}
          {...register("phone")}
        />
        {errors.phone && (
          <p
            id="signup-phone-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.phone.message ?? "Enter a valid phone number"}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        aria-busy={loading}
        className="mt-2 w-full"
      >
        {loading ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline underline-offset-2"
        >
          Log in
        </Link>
      </p>
    </form>
  )
}
