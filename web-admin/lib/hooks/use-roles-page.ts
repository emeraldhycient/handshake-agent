"use client"

import { useState } from "react"
import type { Role } from "@handshake-agent/contracts"

import { useRoles } from "@/lib/query/hooks"

/**
 * The roles page's data layer: the roles read plus the create/edit dialog state. The
 * role editor itself is the shared step-up-gated `RoleEditorDialog` (RBAC writes only,
 * no funds move — §3.1). Built-in roles open read-only.
 */
export function useRolesPage() {
  const roles = useRoles()
  const [editing, setEditing] = useState<Role | null>(null)
  const [open, setOpen] = useState(false)

  function openCreate() {
    setEditing(null)
    setOpen(true)
  }

  function openEdit(role: Role) {
    setEditing(role)
    setOpen(true)
  }

  const roleList = roles.data?.roles ?? []

  return { roles, roleList, editing, open, setOpen, openCreate, openEdit }
}
