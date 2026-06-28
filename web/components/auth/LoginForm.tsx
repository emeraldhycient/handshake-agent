"use client"

/**
 * LoginForm — two-step login form for the /login page.
 *
 * Step 1: email only → calls useLoginRequest()
 * Step 2: OTP → calls useLoginVerify() → stores session → navigates to /
 *
 * DevOtp: when the server returns devOtp, the OTP field is pre-filled and
 * a helper text is displayed so developers can skip copy-pasting.
 *
 * deviceFingerprint is injected at submit time from getDeviceFingerprint()
 * — it is never a visible form field.
 *
 * Strict layering: pure UI — no fetch, no axios, no business logic.
 */
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  LoginRequestSchema,
  type LoginRequest,
} from "@handshake-agent/contracts/auth"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useLoginRequest, useLoginVerify } from "@/lib/query/auth"
import { getDeviceFingerprint } from "@/lib/device"
import type { LoginFormProps } from "@/types/components"

// ─── OTP-only schema for step 2 (deviceFingerprint injected at submit) ───────

const OtpSchema = z.object({
  otp: z
    .string()
    .min(4, "OTP must be at least 4 characters")
    .max(10, "OTP is too long"),
})
type OtpForm = z.infer<typeof OtpSchema>

// ─── Component ────────────────────────────────────────────────────────────────

export function LoginForm({ className }: LoginFormProps) {
  const router = useRouter()
  const [step, setStep] = useState<"request" | "verify">("request")
  const [email, setEmail] = useState("")
  const [devOtp, setDevOtp] = useState<string | undefined>(undefined)

  // ── Step 1 form ──────────────────────────────────────────────────────────────

  const {
    register: registerStep1,
    handleSubmit: handleSubmitStep1,
    formState: { errors: errorsStep1, isSubmitting: isSubmittingStep1 },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
  })

  const loginRequest = useLoginRequest()

  // ── Step 2 form ──────────────────────────────────────────────────────────────

  const {
    register: registerStep2,
    handleSubmit: handleSubmitStep2,
    setValue,
    formState: { errors: errorsStep2, isSubmitting: isSubmittingStep2 },
  } = useForm<OtpForm>({
    resolver: zodResolver(OtpSchema),
    defaultValues: { otp: "" },
  })

  const loginVerify = useLoginVerify()

  // ── Step 1 submit ─────────────────────────────────────────────────────────────

  async function onStep1Submit(values: LoginRequest) {
    try {
      const result = await loginRequest.mutateAsync(values)
      setEmail(values.email)
      if (result.devOtp) {
        setDevOtp(result.devOtp)
        setValue("otp", result.devOtp)
      }
      setStep("verify")
    } catch {
      // Error surfaces via loginRequest.error — rendered below.
    }
  }

  // ── Step 2 submit ─────────────────────────────────────────────────────────────

  async function onStep2Submit(values: OtpForm) {
    try {
      await loginVerify.mutateAsync({
        email,
        otp: values.otp,
        deviceFingerprint: getDeviceFingerprint(),
      })
      router.push("/")
    } catch {
      // Error surfaces via loginVerify.error — rendered below.
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (step === "request") {
    const loading = isSubmittingStep1 || loginRequest.isPending
    const serverError =
      loginRequest.error instanceof Error
        ? loginRequest.error.message
        : loginRequest.error
          ? String(loginRequest.error)
          : null

    return (
      <form
        onSubmit={handleSubmitStep1(onStep1Submit)}
        noValidate
        aria-label="Log in form — step 1"
        className={`flex flex-col gap-5 ${className ?? ""}`}
      >
        {serverError && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {serverError}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="login-email"
            className="text-sm font-medium text-foreground"
          >
            Email address
          </label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            aria-required="true"
            aria-invalid={!!errorsStep1.email}
            aria-describedby={
              errorsStep1.email ? "login-email-error" : undefined
            }
            placeholder="you@example.com"
            disabled={loading}
            {...registerStep1("email")}
          />
          {errorsStep1.email && (
            <p
              id="login-email-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {errorsStep1.email.message ?? "Enter a valid email address"}
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
          {loading ? "Sending OTP…" : "Get OTP"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary underline underline-offset-2"
          >
            Sign up
          </Link>
        </p>
      </form>
    )
  }

  // ── Step 2: verify OTP ────────────────────────────────────────────────────────

  const loading2 = isSubmittingStep2 || loginVerify.isPending
  const serverError2 =
    loginVerify.error instanceof Error
      ? loginVerify.error.message
      : loginVerify.error
        ? String(loginVerify.error)
        : null

  return (
    <form
      onSubmit={handleSubmitStep2(onStep2Submit)}
      noValidate
      aria-label="Log in form — step 2"
      className={`flex flex-col gap-5 ${className ?? ""}`}
    >
      <p className="text-sm text-muted-foreground">
        We sent a one-time code to{" "}
        <span className="font-medium text-foreground">{email}</span>.
      </p>

      {serverError2 && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError2}
        </div>
      )}

      {devOtp && (
        <div className="border-warning bg-warning/10 rounded-md border px-3 py-2 text-sm">
          <span className="text-warning-foreground font-semibold">
            Dev OTP:{" "}
          </span>
          <span className="font-mono">{devOtp}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="login-otp"
          className="text-sm font-medium text-foreground"
        >
          One-time code (OTP)
        </label>
        <Input
          id="login-otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-required="true"
          aria-invalid={!!errorsStep2.otp}
          aria-describedby={errorsStep2.otp ? "login-otp-error" : undefined}
          placeholder="Enter your OTP"
          disabled={loading2}
          {...registerStep2("otp")}
        />
        {errorsStep2.otp && (
          <p
            id="login-otp-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errorsStep2.otp.message ?? "Enter the OTP from your email"}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={loading2}
        aria-busy={loading2}
        className="mt-2 w-full"
      >
        {loading2 ? "Verifying…" : "Verify and log in"}
      </Button>

      <button
        type="button"
        className="text-center text-sm text-muted-foreground underline underline-offset-2"
        onClick={() => {
          setStep("request")
          loginRequest.reset()
          loginVerify.reset()
        }}
      >
        Use a different email
      </button>
    </form>
  )
}
