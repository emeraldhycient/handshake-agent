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
import { ApiError } from "@/lib/api/client"
import { getDeviceFingerprint } from "@/lib/device"
import { useCountdown } from "@/hooks/use-countdown"
import type { LoginFormProps } from "@/types/components"

// Seconds the user must wait before re-requesting an OTP. A client-side cooldown
// that mirrors the server throttle so we don't hammer login/request.
const RESEND_COOLDOWN_SECONDS = 30

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
  // ISO timestamp the resend cooldown ends at; drives the countdown on step 2.
  const [resendReadyAt, setResendReadyAt] = useState<string | undefined>(
    undefined
  )

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

  // Resend cooldown — ticks down from RESEND_COOLDOWN_SECONDS each time a code
  // is (re)sent. The Resend button is disabled until it reaches 0.
  const { secondsLeft: resendSecondsLeft, expired: resendReady } =
    useCountdown(resendReadyAt)

  function startResendCooldown() {
    // Only ever called from event handlers (submit / resend), never during
    // render, so reading the clock here is safe.
    // eslint-disable-next-line react-hooks/purity
    const readyAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1000
    setResendReadyAt(new Date(readyAt).toISOString())
  }

  // ── Step 1 submit ─────────────────────────────────────────────────────────────

  async function onStep1Submit(values: LoginRequest) {
    try {
      const result = await loginRequest.mutateAsync(values)
      setEmail(values.email)
      if (result.devOtp) {
        setDevOtp(result.devOtp)
        setValue("otp", result.devOtp)
      }
      startResendCooldown()
      setStep("verify")
    } catch {
      // Error surfaces via loginRequest.error — rendered below.
    }
  }

  // ── Resend the OTP for the current email (step 2) ──────────────────────────────

  async function onResend() {
    try {
      const result = await loginRequest.mutateAsync({ email })
      if (result.devOtp) {
        setDevOtp(result.devOtp)
        setValue("otp", result.devOtp)
      }
      // A fresh code invalidates any previous wrong-code / locked error.
      loginVerify.reset()
      startResendCooldown()
    } catch {
      // Error surfaces via loginRequest.error — rendered below.
    }
  }

  // ── Step 2 submit ─────────────────────────────────────────────────────────────

  async function onStep2Submit(values: OtpForm) {
    try {
      const result = await loginVerify.mutateAsync({
        email,
        otp: values.otp,
        deviceFingerprint: getDeviceFingerprint(),
      })
      // Route unverified users to onboarding; verified users go to the app.
      if (result.user?.kycStatus === "verified") {
        router.push("/")
      } else {
        router.push("/onboarding")
      }
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
  const resending = loginRequest.isPending

  // A lockout (too many attempts / throttle) is a fundamentally different state
  // from a wrong code: re-entering the OTP can't help — the user must request a
  // fresh code. The server may signal it via a 429 or a "too many"/"locked"
  // message; either way we surface distinct, actionable copy.
  const verifyErr = loginVerify.error
  const isLockedOut =
    (verifyErr instanceof ApiError && verifyErr.status === 429) ||
    (verifyErr instanceof Error && /too many|locked/i.test(verifyErr.message))

  const serverError2 = isLockedOut
    ? "Too many attempts. Request a new code to continue."
    : verifyErr instanceof Error
      ? verifyErr.message
      : verifyErr
        ? String(verifyErr)
        : null

  // Surface a resend failure too, so the resend path is never a silent no-op.
  const resendError =
    loginRequest.error instanceof Error
      ? loginRequest.error.message
      : loginRequest.error
        ? String(loginRequest.error)
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
          className={
            isLockedOut
              ? "rounded-lg border border-warn bg-warn/10 px-4 py-3 text-sm text-warn-foreground"
              : "rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
          }
        >
          {serverError2}
        </div>
      )}

      {resendError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {resendError}
        </div>
      )}

      {devOtp && (
        <div className="rounded-md border border-warn bg-warn/10 px-3 py-2 text-sm">
          <span className="font-semibold text-warn-foreground">Dev OTP: </span>
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

      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          disabled={!resendReady || resending}
          aria-busy={resending}
          className="text-sm font-medium text-primary underline underline-offset-2 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          onClick={onResend}
        >
          {resending
            ? "Resending…"
            : resendReady
              ? "Resend code"
              : `Resend code in ${resendSecondsLeft ?? RESEND_COOLDOWN_SECONDS}s`}
        </button>
        <p className="text-xs text-muted-foreground">
          The code expires after a few minutes. Didn&apos;t get it? Check spam,
          or resend.
        </p>
      </div>

      <button
        type="button"
        className="text-center text-sm text-muted-foreground underline underline-offset-2"
        onClick={() => {
          setStep("request")
          setResendReadyAt(undefined)
          loginRequest.reset()
          loginVerify.reset()
        }}
      >
        Use a different email
      </button>
    </form>
  )
}
