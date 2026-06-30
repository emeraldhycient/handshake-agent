"use client"

/**
 * RoleEditorDialog — create or edit a role with a permission-matrix editor.
 *
 * The matrix is the shared PERMISSION_CATALOG, grouped by `category`. Each row is
 * a checkbox keyed by its canonical `permissionId(...)`. Built-in roles are
 * read-only: every control is disabled when `role.isBuiltin`. Create uses
 * RoleCreateRequestSchema (name + description + permissionIds); edit uses
 * RoleUpdateRequestSchema (description + permissionIds).
 */
import { useMemo, useState } from "react"

import {
  PERMISSION_CATALOG,
  permissionId,
  type PermissionCatalogEntry,
} from "@handshake-agent/contracts"

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
import { Badge } from "@/components/ui/badge"
import { useCreateRole, useUpdateRole } from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import type { RoleEditorDialogProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

// Group the catalog by category once at module load (it is a static constant).
const GROUPED: ReadonlyArray<{
  category: string
  entries: PermissionCatalogEntry[]
}> = (() => {
  const byCategory = new Map<string, PermissionCatalogEntry[]>()
  for (const entry of PERMISSION_CATALOG) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }
  return Array.from(byCategory, ([category, entries]) => ({
    category,
    entries,
  }))
})()

export function RoleEditorDialog({
  open,
  onOpenChange,
  role,
}: RoleEditorDialogProps) {
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
      // Surfaces via the mutation error below.
    }
  }

  const loading = createRole.isPending || updateRole.isPending
  const serverError = errorMessage(createRole.error ?? updateRole.error)
  const selectedCount = useMemo(() => selected.size, [selected])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `Edit role: ${role?.name}` : "Create role"}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "This is a built-in role and cannot be modified."
              : "Select the permissions this role grants."}
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

        <div className="flex flex-col gap-4">
          {!isEditing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. analyst"
                disabled={loading}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this role is for"
              disabled={loading || readOnly}
            />
          </div>

          {/* ── Permission matrix ──────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Permissions</p>
            <Badge variant="secondary">{selectedCount} selected</Badge>
          </div>

          <div className="flex flex-col gap-4">
            {GROUPED.map((group) => (
              <fieldset
                key={group.category}
                className="rounded-md border border-border p-3"
              >
                <legend className="px-1 text-xs font-bold tracking-widest text-muted-foreground uppercase">
                  {group.category}
                </legend>
                <ul className="flex flex-col gap-1.5">
                  {group.entries.map((entry) => {
                    const id = permissionId(entry)
                    const inputId = `perm-${id}`
                    return (
                      <li key={id} className="flex items-start gap-2.5">
                        <input
                          id={inputId}
                          type="checkbox"
                          className="mt-0.5 size-4 accent-primary"
                          checked={selected.has(id)}
                          disabled={readOnly || loading}
                          onChange={() => toggle(id)}
                        />
                        <label
                          htmlFor={inputId}
                          className="flex flex-col text-sm leading-tight"
                        >
                          <span className="font-medium text-foreground">
                            {entry.description}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {entry.resourceId} · {entry.action}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={onSave} disabled={loading} aria-busy={loading}>
              {loading ? "Saving…" : isEditing ? "Save changes" : "Create role"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
