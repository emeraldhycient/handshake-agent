"use client"

/**
 * MfaEnrollDialog — enroll the signed-in admin in TOTP MFA.
 *
 * On open it calls POST /admin/auth/mfa/enroll, then renders the returned QR
 * (an inline SVG string) for the operator to scan, plus the one-time recovery
 * codes (shown once — the operator must save them now). Four async branches:
 * loading / error / empty(n.a.) / data.
 */
import { useEffect } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useEnrollMfa } from "@/lib/query/auth"
import { ApiError } from "@/lib/api/client"
import type { MfaEnrollDialogProps } from "@/types/components"

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Could not start MFA enrollment."
}

export function MfaEnrollDialog({ open, onOpenChange }: MfaEnrollDialogProps) {
  const enroll = useEnrollMfa()
  const { mutate, reset, isIdle } = enroll

  // Kick off enrollment when the dialog opens; reset when it closes so a re-open
  // fetches fresh codes (the previous ones must never be reused/shown again).
  useEffect(() => {
    if (open && isIdle) mutate()
    if (!open) reset()
  }, [open, isIdle, mutate, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set up multi-factor authentication</DialogTitle>
          <DialogDescription>
            Scan the QR code with an authenticator app, then store your recovery
            codes somewhere safe. They are shown only once.
          </DialogDescription>
        </DialogHeader>

        {/* ── Loading ──────────────────────────────────────────────────────── */}
        {(enroll.isPending || enroll.isIdle) && (
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="size-48 rounded-md" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────────── */}
        {enroll.isError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {errorMessage(enroll.error)}
          </div>
        )}

        {/* ── Data ─────────────────────────────────────────────────────────── */}
        {enroll.isSuccess && (
          <div className="flex flex-col gap-4">
            <div
              className="mx-auto size-48 [&_svg]:size-full"
              // The QR is a trusted server-generated SVG (qrcode lib output).
              dangerouslySetInnerHTML={{ __html: enroll.data.qrSvg }}
              aria-label="MFA QR code"
              role="img"
            />
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">
                Recovery codes
              </p>
              <ul className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                {enroll.data.recoveryCodes.map((code) => (
                  <li key={code} className="tabular-nums">
                    {code}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={enroll.isPending}
          >
            {enroll.isSuccess ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
