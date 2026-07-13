"use client"

import { useEffect, useRef, useState } from "react"
import { FormAlert } from "@/components/shared/form-alert"
import { Button } from "@/components/ui/button"
import { useSignupRequest, useSignupVerify } from "@/lib/query/auth"
import { ApiError } from "@/lib/api/client"
import { getDeviceFingerprint } from "@/lib/device"
import { toErrorMessage } from "@/lib/error-message"
import { formatCountdown } from "@/lib/format"
import { useCountdown } from "@/hooks/use-countdown"
import { OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS } from "@/constants/auth"
import type { OtpStepProps } from "@/types"

const OTP_LENGTH = 6

/** Step 2 of 4 — enter and verify the 6-digit signup code. */
export function OtpStep({ data, setData, onNext, onBack }: OtpStepProps) {
  const otp = data.otp ?? ""
  const email = data.email ?? ""
  const cellRefs = useRef<Array<HTMLInputElement | null>>([])
  const submittedRef = useRef<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLockedOut, setIsLockedOut] = useState(false)

  const [expiresAt] = useState(() =>
    new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString()
  )
  const [resendReadyAt, setResendReadyAt] = useState<string>(() =>
    new Date(Date.now() + RESEND_COOLDOWN_SECONDS * 1000).toISOString()
  )
  const { secondsLeft } = useCountdown(expiresAt)
  const { secondsLeft: resendSecondsLeft, expired: resendReady } =
    useCountdown(resendReadyAt)

  const signupVerify = useSignupVerify()
  const signupRequest = useSignupRequest()
  const verifying = signupVerify.isPending
  const resending = signupRequest.isPending

  // Prefill from the dev-OTP echo (AUTH_DEV_EXPOSE_OTP) exactly once, the
  // first time it becomes available.
  useEffect(() => {
    if (data.devOtp && !otp) {
      setData({ otp: data.devOtp })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.devOtp])

  useEffect(() => {
    if (otp.length !== OTP_LENGTH) return
    if (submittedRef.current === otp) return
    submittedRef.current = otp

    async function verify() {
      setServerError(null)
      setIsLockedOut(false)
      try {
        await signupVerify.mutateAsync({
          email,
          otp,
          deviceFingerprint: getDeviceFingerprint(),
        })
        onNext()
      } catch (err) {
        submittedRef.current = null
        const lockedOut =
          (err instanceof ApiError && err.status === 429) ||
          (err instanceof Error && /too many|locked/i.test(err.message))
        setIsLockedOut(lockedOut)
        setServerError(
          lockedOut
            ? "Too many attempts. Request a new code to continue."
            : (toErrorMessage(err) ?? "That code didn't work. Try again.")
        )
      }
    }
    void verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, email])

  function updateCell(index: number, digit: string) {
    const next = otp.split("")
    next[index] = digit
    const joined = next.join("").slice(0, OTP_LENGTH)
    setData({ otp: joined })
    if (digit && index < OTP_LENGTH - 1) {
      cellRefs.current[index + 1]?.focus()
    }
  }

  function onCellChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1)
    updateCell(index, digit)
  }

  function onCellKeyDown(
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      e.preventDefault()
      const next = otp.split("")
      next[index - 1] = ""
      setData({ otp: next.join("") })
      cellRefs.current[index - 1]?.focus()
    }
  }

  async function onResend() {
    setServerError(null)
    setIsLockedOut(false)
    try {
      const result = await signupRequest.mutateAsync(email)
      setData({ otp: "", devOtp: result.devOtp })
      submittedRef.current = null
      setResendReadyAt(
        new Date(Date.now() + RESEND_COOLDOWN_SECONDS * 1000).toISOString()
      )
      cellRefs.current[0]?.focus()
    } catch (err) {
      setServerError(
        toErrorMessage(err) ?? "Couldn't resend the code. Try again."
      )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Step 2 of 4
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
          Enter your code
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">
          Sent to <span className="font-bold text-foreground">{email}</span>.
          Expires in{" "}
          <span className="font-bold text-foreground tabular-nums">
            {formatCountdown(secondsLeft ?? 0)}
          </span>
          .
        </p>
      </div>

      {serverError && (
        <FormAlert tone={isLockedOut ? "warn" : "danger"}>
          {serverError}
        </FormAlert>
      )}

      {data.devOtp && (
        <div className="rounded-md border border-warn bg-warn/10 px-3 py-2 text-sm">
          <span className="font-semibold text-warn-foreground">Dev OTP: </span>
          <span className="font-mono">{data.devOtp}</span>
        </div>
      )}

      <div className="flex gap-2.5" role="group" aria-label="One-time code">
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              cellRefs.current[i] = el
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            aria-label={`Digit ${i + 1}`}
            value={otp[i] ?? ""}
            disabled={verifying}
            onChange={(e) => onCellChange(i, e.target.value)}
            onKeyDown={(e) => onCellKeyDown(i, e)}
            className={`h-16 w-full min-w-0 flex-1 rounded-2xl border-2 bg-card text-center text-2xl font-extrabold text-foreground tabular-nums shadow-xs focus:outline-none ${
              otp[i] ? "border-primary" : "border-input"
            }`}
          />
        ))}
      </div>

      <div className="flex items-center gap-5">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={verifying}
        >
          Back
        </Button>
        <p className="text-sm text-muted-foreground">
          Didn&apos;t get it?{" "}
          <button
            type="button"
            onClick={onResend}
            disabled={!resendReady || resending}
            className="font-bold text-primary underline underline-offset-2 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          >
            {resending
              ? "Resending…"
              : resendReady
                ? "Resend code"
                : `Resend in ${resendSecondsLeft ?? RESEND_COOLDOWN_SECONDS}s`}
          </button>
        </p>
      </div>

      {verifying && (
        <p role="status" className="text-sm text-muted-foreground">
          Verifying…
        </p>
      )}
    </div>
  )
}
