"use client"

/**
 * AdminRowActions — per-row sensitive actions for an admin user: change role and
 * change status (suspend / reactivate / offboard), plus reset 2FA. Composition
 * only: the step-up-gated mutations + RBAC/self-lockout derivation live in
 * `useAdminRowActions`. An operator only sees an action they hold the permission
 * for, and never a suspend/offboard on their own row; the API re-enforces all of
 * it server-side (§3.3).
 */
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { AdminResetMfaAction } from "@/components/admin/admin-reset-mfa-action"
import { useAdminRowActions } from "@/lib/hooks/use-admin-row-actions"
import type { AdminRowActionsProps } from "@/types/components"

export function AdminRowActions({ admin, roles }: AdminRowActionsProps) {
  const {
    me,
    stepUp,
    localError,
    busy,
    access,
    transitions,
    hasAnyAction,
    changeRole,
    changeStatus,
    onStepUpSuccess,
  } = useAdminRowActions({ admin })

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
        onSuccess={onStepUpSuccess}
      />
    </div>
  )
}
