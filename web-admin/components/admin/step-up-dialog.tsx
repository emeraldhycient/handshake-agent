"use client"

/**
 * StepUpDialog — re-authentication modal for sensitive admin actions.
 *
 * Opened by a caller after a mutation 403s with code `ADMIN_STEP_UP_REQUIRED`.
 * The operator re-enters their password (or a TOTP if MFA is enabled) → POST
 * /admin/auth/step-up → on success we close and call `onSuccess`, which retries
 * the original mutation. The dialog is focus-trapped and Esc-closable (Radix).
 */
import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useStepUp } from "@/lib/query/auth"
import { toErrorMessage } from "@/lib/error-message"
import type { StepUpDialogProps } from "@/types"

export function StepUpDialog({
  open,
  mfaEnabled,
  onSuccess,
  onOpenChange,
}: StepUpDialogProps) {
  const [password, setPassword] = useState("")
  const [totp, setTotp] = useState("")
  const stepUp = useStepUp()

  async function onConfirm() {
    try {
      await stepUp.mutateAsync(mfaEnabled ? { totp } : { password })
      setPassword("")
      setTotp("")
      stepUp.reset()
      onOpenChange(false)
      onSuccess()
    } catch {
      // Error surfaces via stepUp.error — rendered below.
    }
  }

  const loading = stepUp.isPending
  const serverError = toErrorMessage(stepUp.error)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm it&apos;s you</DialogTitle>
          <DialogDescription>
            This action is sensitive. Re-authenticate to continue.
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {serverError}
          </div>
        )}

        {mfaEnabled ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stepup-totp">Authenticator code (TOTP)</Label>
            <Input
              id="stepup-totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              disabled={loading}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stepup-password">Password</Label>
            <Input
              id="stepup-password"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={loading} aria-busy={loading}>
            {loading ? "Verifying…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
