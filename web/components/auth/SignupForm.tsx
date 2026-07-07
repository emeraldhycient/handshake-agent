"use client"

/**
 * SignupForm — orchestrator for the /signup page.
 *
 * Collects email + phone via the shared FormField, submits via useSignup().
 * On success it renders SignupSuccess ("check your email" + optional dev link).
 *
 * Strict layering: pure UI — no fetch, no axios, no business logic (root §16).
 */
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  SignupRequestSchema,
  type SignupRequest,
} from "@handshake-agent/contracts/auth"
import { FormField } from "@/components/shared/form-field"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { SignupSuccess } from "@/components/auth/signup/signup-success"
import { useSignup } from "@/lib/query/auth"
import { toErrorMessage } from "@/lib/error-message"
import type { SignupFormProps } from "@/types/components"

export function SignupForm({ className }: SignupFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequest>({ resolver: zodResolver(SignupRequestSchema) })

  const { mutateAsync, isPending, isSuccess, error, data } = useSignup()
  const loading = isSubmitting || isPending

  async function onSubmit(values: SignupRequest) {
    try {
      await mutateAsync(values)
    } catch {
      // Error surfaces via mutation.error — rendered below. Never silently drop.
    }
  }

  if (isSuccess) return <SignupSuccess devToken={data?.devToken} />

  const serverError = toErrorMessage(error)

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Create account form"
      className={`flex flex-col gap-5 ${className ?? ""}`}
    >
      {serverError && <FormAlert>{serverError}</FormAlert>}

      <FormField
        id="signup-email"
        label="Email address"
        type="email"
        autoComplete="email"
        aria-required="true"
        placeholder="you@example.com"
        disabled={loading}
        error={errors.email?.message}
        {...register("email")}
      />

      <FormField
        id="signup-phone"
        label="Phone number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        aria-required="true"
        placeholder="+2348012345678"
        disabled={loading}
        error={errors.phone?.message}
        {...register("phone")}
      />

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
