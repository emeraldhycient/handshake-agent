"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import {
  LoginRequestSchema,
  type LoginRequest,
} from "@handshake-agent/contracts/auth"
import { FormField } from "@/components/shared/form-field"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { AuthStepHeader } from "../AuthStepHeader"
import { useLoginRequest } from "@/lib/query/auth"
import { toErrorMessage } from "@/lib/error-message"
import type { LoginRequestStepProps } from "@/types/auth"

/** Step 1 of login — request an OTP for an email address. */
export function LoginRequestStep({ onSent, className }: LoginRequestStepProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(LoginRequestSchema) })

  const loginRequest = useLoginRequest()
  const loading = isSubmitting || loginRequest.isPending
  const serverError = toErrorMessage(loginRequest.error)

  async function onSubmit(values: LoginRequest) {
    try {
      const result = await loginRequest.mutateAsync(values)
      onSent(values.email, result.devOtp)
    } catch {
      // Error surfaces via loginRequest.error — rendered below.
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Log in form — step 1"
      className={`flex flex-col gap-5 ${className ?? ""}`}
    >
      <AuthStepHeader
        eyebrow="Log in"
        heading="Welcome back"
        subcopy="Enter your email and we'll send you a one-time code."
      />

      {serverError && <FormAlert>{serverError}</FormAlert>}

      <FormField
        id="login-email"
        label="Email address"
        type="email"
        autoComplete="email"
        aria-required="true"
        placeholder="you@example.com"
        disabled={loading}
        error={
          errors.email
            ? (errors.email.message ?? "Enter a valid email address")
            : undefined
        }
        {...register("email")}
      />

      <Button
        type="submit"
        variant="accent"
        size="xl"
        disabled={loading}
        aria-busy={loading}
        className="mt-[22px] w-full"
      >
        {loading ? "Sending OTP…" : "Get OTP"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/get-started"
          className="font-medium text-primary underline underline-offset-2"
        >
          Sign up
        </Link>
      </p>
    </form>
  )
}
