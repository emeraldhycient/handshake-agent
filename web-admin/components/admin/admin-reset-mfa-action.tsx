"use client"

/**
 * AdminResetMfaAction — the per-row "Reset 2FA" action for another admin (§3.4).
 * Resetting an admin's 2FA is a sensitive RBAC write: it clears the target's
 * authenticator so they must re-enroll. It reveals no secret and moves no money
 * (§3.1) — but it must be reason-audited and step-up-gated.
 *
 * The chain mirrors the canonical funds-safety flow (sanctions-page pattern):
 *   Reset 2FA → ReasonModal (recorded in the immutable audit log)
 *             → StepUpModal (client TOTP prompt)
 *             → useResetAdminMfa (POST /admin/admins/:id/mfa/reset).
 * The server independently re-checks step-up + write permission; a 403
 * ADMIN_STEP_UP_REQUIRED opens `StepUpDialog` and the POST replays after re-auth
 * (`useStepUpRetry`). On success we toast + the hook invalidates the admins query.
 */
import { useState } from "react"
import type { AdminUser } from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { ReasonModal, StepUpModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useResetAdminMfa } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"

/**
 * Props for {@link AdminResetMfaAction}. Kept local (not in `types/components.ts`)
 * because it is a single-use shape scoped to this one action row-cell; the shared
 * `AdminRowActionsProps` next to it already lives in `types/components.ts`.
 */
interface AdminResetMfaActionProps {
  admin: AdminUser
}

// The active reset flow step (reason → step-up), or null when closed.
type FlowStep = "reason" | "stepup" | null

/** Normalizes a mutation/step-up failure into a user-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

export function AdminResetMfaAction({ admin }: AdminResetMfaActionProps) {
  const me = useAdminMe()
  const reset = useResetAdminMfa()
  const stepUp = useStepUpRetry()

  const [step, setStep] = useState<FlowStep>(null)
  // The reason captured in step 1, carried into the mutation fired from step 2.
  const [reason, setReason] = useState("")

  /** Fire the reset through the server step-up guard; a 403 opens StepUpDialog. */
  function submit(auditReason: string) {
    setStep(null)
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          reset.mutateAsync({ id: admin.id, reason: auditReason })
        )
        if (ok) pushToast(`${admin.displayName} · 2FA reset`, "ok")
        // ok === false → a step-up challenge opened; StepUpDialog replays it.
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={reset.isPending}
        onClick={() => {
          setReason("")
          setStep("reason")
        }}
      >
        Reset 2FA for {admin.email}
      </Button>

      {/* Step 1 — reason (audited). */}
      <ReasonModal
        open={step === "reason"}
        onOpenChange={(next) => !next && setStep(null)}
        title={`Reset 2FA — ${admin.displayName}`}
        onContinue={(entered) => {
          setReason(entered)
          setStep("stepup")
        }}
      />

      {/* Step 2 — client step-up TOTP; completing it fires the reset. */}
      <StepUpModal
        open={step === "stepup"}
        onOpenChange={(next) => !next && setStep(null)}
        title={`Reset 2FA — ${admin.displayName}`}
        onComplete={() => submit(reason)}
      />

      {/* Server-side step-up re-auth: a 403 on the POST opens this; it replays
          after re-authentication, then toasts. */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((ok) => {
              if (ok) pushToast(`${admin.displayName} · 2FA reset`, "ok")
            })
            .catch((error) => pushToast(errorMessage(error), "warn"))
        }}
      />
    </>
  )
}
