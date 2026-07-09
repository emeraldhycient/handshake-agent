"use client"

/**
 * AdminResetMfaAction — the per-row "Reset 2FA" action for another admin (§3.4).
 * Resetting an admin's 2FA is a sensitive RBAC write: it clears the target's
 * authenticator so they must re-enroll. It reveals no secret and moves no money
 * (§3.1) — but it must be reason-audited and step-up-gated.
 *
 * The chain mirrors the canonical funds-safety flow (sanctions-page pattern):
 *   Reset 2FA → ReasonModal (recorded in the immutable audit log)
 *             → useResetAdminMfa (POST /admin/admins/:id/mfa/reset).
 * The REAL step-up is server-driven: the server re-checks step-up + write
 * permission; a 403 ADMIN_STEP_UP_REQUIRED opens `StepUpDialog` and the POST
 * replays after re-auth (`useStepUpRetry`). On success we toast + the hook
 * invalidates the admins query.
 */
import { useState } from "react"
import type { AdminUser } from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { ReasonModal } from "@/components/admin/flows"
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

// The active reset flow step, or null when closed.
type FlowStep = "reason" | null

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
        onClick={() => setStep("reason")}
      >
        Reset 2FA for {admin.email}
      </Button>

      {/* Reason (audited) → the step-up-guarded POST fires directly; the server
          demands re-auth via 403 when the operator's step-up is stale. */}
      <ReasonModal
        open={step === "reason"}
        onOpenChange={(next) => !next && setStep(null)}
        title={`Reset 2FA — ${admin.displayName}`}
        onContinue={(entered) => submit(entered)}
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
