"use client"

/**
 * AdminsPage — the admin-user management surface. Lists admins (email / status /
 * role / last login), offers an "Invite admin" dialog, and per-row sensitive
 * actions (change role, suspend/reactivate/offboard) gated by step-up.
 *
 * Four async branches on the admins query: loading / error / empty / data.
 */
import { useState } from "react"
import { UserPlus } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/admin/status-badge"
import { AdminRowActions } from "@/components/admin/admin-row-actions"
import { InviteAdminDialog } from "@/components/admin/invite-admin-dialog"
import { useAdmins, useRoles } from "@/lib/query/hooks"

function formatDate(iso: string | null): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString()
}

export function AdminsPage() {
  const admins = useAdmins()
  const roles = useRoles()
  const [inviteOpen, setInviteOpen] = useState(false)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Admins
        </h1>
        <Button
          size="sm"
          onClick={() => setInviteOpen(true)}
          disabled={!roles.data}
        >
          <UserPlus aria-hidden="true" />
          Invite admin
        </Button>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {admins.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {admins.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load admins
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {admins.isSuccess && admins.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No admins yet.</p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {admins.isSuccess && admins.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.data.items.map((admin) => (
                <TableRow key={admin.id}>
                  <TableCell className="font-medium text-foreground">
                    {admin.email}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={admin.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {admin.role.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(admin.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <AdminRowActions
                      admin={admin}
                      roles={roles.data?.roles ?? []}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <InviteAdminDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles.data?.roles ?? []}
      />
    </div>
  )
}
