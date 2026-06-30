"use client"

/**
 * UserDeviceList — the user's bound/revoked devices with a per-device Revoke
 * action and a "pinned" marker (the device the identity is anchored to, root
 * §3.4). Revoke is sensitive (step-up-gated via `useStepUpRetry`).
 *
 * A revoked or already-pinned-only device is shown for context; only bound,
 * non-revoked devices offer a Revoke button.
 */
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useRevokeDevice } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { UserDeviceListProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

export function UserDeviceList({ userId, devices }: UserDeviceListProps) {
  const me = useAdminMe()
  const revoke = useRevokeDevice()
  const stepUp = useStepUpRetry()
  const [localError, setLocalError] = useState<string | null>(null)

  function onRevoke(deviceId: string) {
    setLocalError(null)
    void (async () => {
      try {
        await stepUp.run(() =>
          revoke.mutateAsync({ id: userId, deviceId }).then(() => undefined)
        )
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  if (devices.length === 0) {
    return <p className="text-xs text-muted-foreground">No devices.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {devices.map((device) => (
          <li
            key={device.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">
                  {device.id.slice(0, 8)}…
                </span>
                <Badge
                  variant={
                    device.trustState === "bound"
                      ? "default"
                      : device.trustState === "revoked"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {device.trustState}
                </Badge>
                {device.isPinned && <Badge variant="secondary">pinned</Badge>}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Last used {formatDate(device.lastUsedAt)}
              </span>
            </div>
            {device.trustState === "bound" && (
              <Button
                size="sm"
                variant="destructive"
                disabled={revoke.isPending}
                onClick={() => onRevoke(device.id)}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>

      {localError && (
        <p role="alert" className="text-xs text-destructive">
          {localError}
        </p>
      )}

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
    </div>
  )
}
