"use client"

import { useState } from "react"
import type { Role } from "@handshake-agent/contracts"

import { useAdmins, usePermissions, useRoles } from "@/lib/query/hooks"

/**
 * The "Admins & roles" data layer: the three reads (admins, roles, permissions), the
 * derived matrix branch flags, and the invite / role-editor dialog state. The sensitive
 * writes themselves live in the shared step-up-gated components (AdminRowActions,
 * RoleEditorDialog, InviteAdminDialog) — RBAC writes only, no funds move (§3.1).
 */
export function useAdminsPage() {
  const [inviteOpen, setInviteOpen] = useState(false)

  const adminsQuery = useAdmins()
  const rolesQuery = useRoles()
  const permissionsQuery = usePermissions()

  const admins = adminsQuery.data?.items ?? []
  const roles = rolesQuery.data?.roles ?? []
  const permissions = permissionsQuery.data?.permissions ?? []

  const matrixLoading = rolesQuery.isLoading || permissionsQuery.isLoading
  const matrixError = rolesQuery.isError || permissionsQuery.isError
  const matrixReady = rolesQuery.isSuccess && permissionsQuery.isSuccess
  const matrixEmpty = matrixReady && roles.length === 0

  // Role editor (create / edit permissions) — `roleEdit` holds the target role, or
  // null when creating. The wired RoleEditorDialog runs useCreateRole / useUpdateRole
  // and invalidates the roles query on success.
  const [roleEditorOpen, setRoleEditorOpen] = useState(false)
  const [roleEdit, setRoleEdit] = useState<Role | null>(null)

  function openCreateRole() {
    setRoleEdit(null)
    setRoleEditorOpen(true)
  }

  function retryMatrix() {
    void rolesQuery.refetch()
    void permissionsQuery.refetch()
  }

  return {
    adminsQuery,
    admins,
    roles,
    permissions,
    matrixLoading,
    matrixError,
    matrixReady,
    matrixEmpty,
    inviteOpen,
    setInviteOpen,
    roleEditorOpen,
    setRoleEditorOpen,
    roleEdit,
    openCreateRole,
    retryMatrix,
  }
}
