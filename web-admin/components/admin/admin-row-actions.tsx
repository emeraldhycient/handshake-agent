"use client"

/**
 * AdminRowActions — per-row sensitive actions for an admin user: change role
 * and change status (suspend / reactivate / offboard). Both are gated by a fresh
 * step-up: we attempt the mutation, and if it 403s with ADMIN_STEP_UP_REQUIRED
 * we open the StepUpDialog; after re-auth the stashed mutation is retried.
 *
 * The signed-in admin's `mfaEnabled` (from useAdminMe) decides whether step-up
 * asks for a password or a TOTP.
 */
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { AdminResetMfaAction } from "@/components/admin/admin-reset-mfa-action"
import { useAdminMe } from "@/lib/query/hooks"
import { useSetAdminStatus, useUpdateAdminRole } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { adminMgmtAccess } from "@/lib/permissions"
import type { AdminRowActionsProps } from "@/types/components"

// Status transitions offered per current status (settable statuses only).
const NEXT_STATUS: Record<
  string,
  { label: string; status: "active" | "suspended" | "offboarded" }[]
> = {
  active: [
    { label: "Suspend", status: "suspended" },
    { label: "Offboard", status: "offboarded" },
  ],
  pending: [{ label: "Offboard", status: "offboarded" }],
  suspended: [
    { label: "Reactivate", status: "active" },
    { label: "Offboard", status: "offboarded" },
  ],
  offboarded: [{ label: "Reactivate", status: "active" }],
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function AdminRowActions({ admin, roles }: AdminRowActionsProps) {
  const me = useAdminMe()
  const updateRole = useUpdateAdminRole()
  const setStatus = useSetAdminStatus()
  const stepUp = useStepUpRetry()
  const [localError, setLocalError] = useState<string | null>(null)

  async function changeRole(roleId: string) {
    if (roleId === admin.role.id) return
    setLocalError(null)
    try {
      await stepUp.run(() =>
        updateRole.mutateAsync({ id: admin.id, input: { roleId } })
      )
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  async function changeStatus(status: "active" | "suspended" | "offboarded") {
    setLocalError(null)
    try {
      await stepUp.run(() =>
        setStatus.mutateAsync({ id: admin.id, input: { status } })
      )
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  const busy = updateRole.isPending || setStatus.isPending

  // RBAC gating (§3.3 — the API re-enforces all of this server-side). An operator
  // only sees an action they hold the permission for, and the lifecycle self-guard
  // hides suspend/offboard on their OWN row (they cannot lock themselves out).
  const access = adminMgmtAccess(me.data, admin.id)
  const transitions = access.canChangeStatus
    ? (NEXT_STATUS[admin.status] ?? []).filter(
        (t) =>
          !(
            access.isSelf &&
            (t.status === "suspended" || t.status === "offboarded")
          )
      )
    : []
  const hasAnyAction =
    access.canChangeRole || access.canResetMfa || transitions.length > 0

  // Read-only row (operator lacks every admin-management permission, or only
  // self-forbidden actions remain) → a muted dash, never blank.
  if (!hasAnyAction) {
    return <span className="text-[12px] text-ink3">—</span>
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {access.canResetMfa && <AdminResetMfaAction admin={admin} />}

        {access.canChangeRole && (
          <NativeSelect
            aria-label={`Change role for ${admin.email}`}
            value={admin.role.id}
            disabled={busy}
            onChange={(e) => changeRole(e.target.value)}
            className="h-8 w-40 rounded-[10px] text-xs"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        )}

        {transitions.map((t) => (
          <Button
            key={t.status}
            size="sm"
            variant={t.status === "active" ? "outline" : "destructive"}
            disabled={busy}
            onClick={() => changeStatus(t.status)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {localError && (
        <p role="alert" className="text-[11.5px] font-semibold text-tdn">
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
