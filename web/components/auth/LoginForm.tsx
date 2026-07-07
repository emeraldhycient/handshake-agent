"use client"

/**
 * LoginForm — two-step login orchestrator for the /login page.
 *
 * Step 1 (LoginRequestStep): email → request OTP.
 * Step 2 (LoginVerifyStep): OTP → verify → navigate (/ or /onboarding).
 *
 * Each step owns its own form + mutations; this orchestrator holds only the
 * cross-step state (which step, the email, and any dev OTP). Switching steps
 * unmounts the other step, which clears its mutation/error state (root §16).
 */
import { useState } from "react"
import { LoginRequestStep } from "./login/login-request-step"
import { LoginVerifyStep } from "./login/login-verify-step"
import type { LoginFormProps } from "@/types/components"

export function LoginForm({ className }: LoginFormProps) {
  const [step, setStep] = useState<"request" | "verify">("request")
  const [email, setEmail] = useState("")
  const [devOtp, setDevOtp] = useState<string | undefined>(undefined)

  if (step === "request") {
    return (
      <LoginRequestStep
        className={className}
        onSent={(sentEmail, sentDevOtp) => {
          setEmail(sentEmail)
          setDevOtp(sentDevOtp)
          setStep("verify")
        }}
      />
    )
  }

  return (
    <LoginVerifyStep
      className={className}
      email={email}
      initialDevOtp={devOtp}
      onUseDifferentEmail={() => {
        setDevOtp(undefined)
        setStep("request")
      }}
    />
  )
}
