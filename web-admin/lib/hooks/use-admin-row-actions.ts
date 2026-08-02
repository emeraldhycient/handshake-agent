"use client"

import { useState } from "react"

import { toErrorMessage } from "@/lib/error-message"
import { adminMgmtAccess } from "@/lib/permissions"
import { buildStatusTransitions } from "@/lib/admins/row-actions"
import {
  useAdminMe,
  useSetAdminStatus,
  useUpdateAdminRole,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import type {
  AdminRowActionsProps,
  AdminSettableStatus,
} from "@/types"

/**
 * View-model for the per-row admin actions (change role / change status). Both
 * mutations are gated by a fresh step-up: `stepUp.run` attempts the mutation and,
 * on a 403 ADMIN_STEP_UP_REQUIRED, opens the StepUpDialog and replays after
 * re-auth. RBAC + the self-lockout guard are derived here (`access`, `transitions`,
 * `hasAnyAction`) purely for what to render — the API re-enforces all of it
 * server-side (§3.3). The model proposes; the engine disposes (§3.1).
 */
export function useAdminRowActions({ admin }: Pick<AdminRowActionsProps, "admin">) {
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
      setLocalError(toErrorMessage(error))
    }
  }

  async function changeStatus(status: AdminSettableStatus) {
    setLocalError(null)
    try {
      await stepUp.run(() =>
        setStatus.mutateAsync({ id: admin.id, input: { status } })
      )
    } catch (error) {
      setLocalError(toErrorMessage(error))
    }
  }

  function onStepUpSuccess() {
    void stepUp.retry().catch((error) => setLocalError(toErrorMessage(error)))
  }

  const access = adminMgmtAccess(me.data, admin.id)
  const transitions = buildStatusTransitions(admin.status, access)

  return {
    me,
    stepUp,
    localError,
    busy: updateRole.isPending || setStatus.isPending,
    access,
    transitions,
    hasAnyAction:
      access.canChangeRole || access.canResetMfa || transitions.length > 0,
    changeRole,
    changeStatus,
    onStepUpSuccess,
  }
}
