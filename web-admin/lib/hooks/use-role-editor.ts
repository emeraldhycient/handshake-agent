"use client"

import { useMemo, useState } from "react"
import type { Role } from "@handshake-agent/contracts"

import { useCreateRole, useUpdateRole } from "@/lib/query/hooks"
import { toErrorMessage } from "@/lib/error-message"

/**
 * The role create/edit state machine: name + description + a selected-permission set,
 * saved via create (name + description + permissionIds) or update (description +
 * permissionIds). Built-in roles are read-only. RBAC writes only — no funds move
 * (§3.1). Extracted so the dialog is presentation.
 */
export function useRoleEditor(
  role: Role | null,
  onOpenChange: (open: boolean) => void
) {
  const isEditing = role !== null
  const readOnly = role?.isBuiltin ?? false

  const [name, setName] = useState(role?.name ?? "")
  const [description, setDescription] = useState(role?.description ?? "")
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role?.permissionIds ?? [])
  )

  const createRole = useCreateRole()
  const updateRole = useUpdateRole()

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onSave() {
    const permissionIds = Array.from(selected)
    try {
      if (isEditing && role) {
        await updateRole.mutateAsync({
          id: role.id,
          input: { description, permissionIds },
        })
      } else {
        await createRole.mutateAsync({ name, description, permissionIds })
      }
      onOpenChange(false)
    } catch {
      // Surfaces via serverError below.
    }
  }

  const loading = createRole.isPending || updateRole.isPending
  const serverError = toErrorMessage(createRole.error ?? updateRole.error)
  const selectedCount = useMemo(() => selected.size, [selected])

  return {
    isEditing,
    readOnly,
    name,
    setName,
    description,
    setDescription,
    selected,
    toggle,
    onSave,
    loading,
    serverError,
    selectedCount,
  }
}
