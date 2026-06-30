"use client"

/**
 * RolesPage — list roles and create / edit them via the permission-matrix
 * editor. Built-in roles open read-only (the editor disables every control).
 * Four async branches on the roles query: loading / error / empty / data.
 */
import { useState } from "react"
import { Plus } from "lucide-react"
import type { Role } from "@handshake-agent/contracts"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { RoleEditorDialog } from "@/components/admin/role-editor-dialog"
import { useRoles } from "@/lib/query/hooks"

export function RolesPage() {
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

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Roles &amp; permissions
        </h1>
        <Button size="sm" onClick={openCreate}>
          <Plus aria-hidden="true" />
          New role
        </Button>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {roles.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {roles.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load roles
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {roles.isSuccess && roles.data.roles.length === 0 && (
        <p className="text-sm text-muted-foreground">No roles defined.</p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {roles.isSuccess && roles.data.roles.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data.roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium text-foreground">
                    <span className="flex items-center gap-2">
                      {role.name}
                      {role.isBuiltin && (
                        <Badge variant="outline">built-in</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {role.description}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {role.permissionIds.length}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(role)}
                    >
                      {role.isBuiltin ? "View" : "Edit"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {open && (
        <RoleEditorDialog
          // Remount per target so the editor's internal state re-seeds.
          key={editing?.id ?? "create"}
          open={open}
          onOpenChange={setOpen}
          role={editing}
        />
      )}
    </div>
  )
}
