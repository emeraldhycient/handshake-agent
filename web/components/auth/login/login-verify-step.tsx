"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { FormField } from "@/components/shared/form-field"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { LoginResendControls } from "./login-resend-controls"
import { useLoginRequest, useLoginVerify } from "@/lib/query/auth"
import { ApiError } from "@/lib/api/client"
import { getDeviceFingerprint } from "@/lib/device"
import { toErrorMessage } from "@/lib/error-message"
import { useCountdown } from "@/hooks/use-countdown"
import { RESEND_COOLDOWN_SECONDS } from "@/constants/auth"
import type { LoginVerifyStepProps } from "@/types/auth"

const OtpSchema = z.object({
  otp: z
    .string()
    .min(4, "OTP must be at least 4 characters")
    .max(10, "OTP is too long"),
})
type OtpForm = z.infer<typeof OtpSchema>

/** Step 2 of login — verify the OTP, with resend + lockout handling. */
export function LoginVerifyStep({
  email,
  initialDevOtp,
  onUseDifferentEmail,
  className,
}: LoginVerifyStepProps) {
  const router = useRouter()
  const [devOtp, setDevOtp] = useState<string | undefined>(initialDevOtp)
  // A code was just sent when this step mounted — seed the resend cooldown. This
  // component is only ever reached via a click (never SSR-rendered), so reading
  // the clock in the lazy initializer is safe and avoids a set-state-in-effect.
  const [resendReadyAt, setResendReadyAt] = useState<string>(() =>
    new Date(Date.now() + RESEND_COOLDOWN_SECONDS * 1000).toISOString()
  )

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<OtpForm>({
    resolver: zodResolver(OtpSchema),
    defaultValues: { otp: initialDevOtp ?? "" },
  })

  const loginVerify = useLoginVerify()
  const loginRequest = useLoginRequest()
  const { secondsLeft: resendSecondsLeft, expired: resendReady } =
    useCountdown(resendReadyAt)

  function startResendCooldown() {
    const readyAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1000
    setResendReadyAt(new Date(readyAt).toISOString())
  }

  async function onSubmit(values: OtpForm) {
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

  async function onResend() {
    try {
      const result = await loginRequest.mutateAsync({ email })
      if (result.devOtp) {
        setDevOtp(result.devOtp)
        setValue("otp", result.devOtp)
      }
      loginVerify.reset()
      startResendCooldown()
    } catch {
      // Error surfaces via loginRequest.error — rendered below.
    }
  }

  const loading = isSubmitting || loginVerify.isPending
  const resending = loginRequest.isPending

  // A lockout (too many attempts / throttle) is a fundamentally different state
  // from a wrong code: re-entering the OTP can't help — request a fresh code.
  const verifyErr = loginVerify.error
  const isLockedOut =
    (verifyErr instanceof ApiError && verifyErr.status === 429) ||
    (verifyErr instanceof Error && /too many|locked/i.test(verifyErr.message))

  const serverError = isLockedOut
    ? "Too many attempts. Request a new code to continue."
    : toErrorMessage(verifyErr)

  const resendError = toErrorMessage(loginRequest.error)

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Log in form — step 2"
      className={`flex flex-col gap-5 ${className ?? ""}`}
    >
      <p className="text-sm text-muted-foreground">
        We sent a one-time code to{" "}
        <span className="font-medium text-foreground">{email}</span>.
      </p>

      {serverError && (
        <FormAlert tone={isLockedOut ? "warn" : "danger"}>
          {serverError}
        </FormAlert>
      )}

      {resendError && <FormAlert>{resendError}</FormAlert>}

      {devOtp && (
        <div className="rounded-md border border-warn bg-warn/10 px-3 py-2 text-sm">
          <span className="font-semibold text-warn-foreground">Dev OTP: </span>
          <span className="font-mono">{devOtp}</span>
        </div>
      )}

      <FormField
        id="login-otp"
        label="One-time code (OTP)"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-required="true"
        placeholder="Enter your OTP"
        disabled={loading}
        error={
          errors.otp
            ? (errors.otp.message ?? "Enter the OTP from your email")
            : undefined
        }
        {...register("otp")}
      />

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        aria-busy={loading}
        className="mt-2 w-full"
      >
        {loading ? "Verifying…" : "Verify and log in"}
      </Button>

      <LoginResendControls
        resending={resending}
        resendReady={resendReady}
        resendSecondsLeft={resendSecondsLeft ?? null}
        onResend={onResend}
        onUseDifferentEmail={onUseDifferentEmail}
      />
    </form>
  )
}
