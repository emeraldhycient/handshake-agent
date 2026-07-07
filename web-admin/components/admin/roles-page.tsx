"use client"

/**
 * RolesPage — list roles and create / edit them via the shared permission-matrix
 * editor, plus a read-only role permission matrix (categories × roles). Composition
 * only: `useRolesPage` owns the roles read + the editor dialog state; the table +
 * matrix live in `components/admin/roles/*`. Built-in roles open read-only. RBAC
 * writes only — no funds move (§3.1). Four async branches on the roles query.
 */
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RoleEditorDialog } from "@/components/admin/role-editor-dialog"
import { RolesTable } from "@/components/admin/roles/roles-table"
import { RoleAccessMatrix } from "@/components/admin/roles/role-access-matrix"
import { useRolesPage } from "@/lib/hooks/use-roles-page"

export function RolesPage() {
  const r = useRolesPage()

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-1 flex-col gap-5 overflow-y-auto px-6 py-6 sm:px-8">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Roles &amp; permissions
          </h1>
          <p className="mt-1.5 text-[13.5px] text-ink2">
            Built-in and custom roles, and the permissions each grants across
            the console.
          </p>
        </div>
        <Button size="sm" onClick={r.openCreate}>
          <Plus aria-hidden="true" />
          New role
        </Button>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {r.roles.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-[16px]" />
          <Skeleton className="h-12 w-full rounded-[16px]" />
          <Skeleton className="h-40 w-full rounded-[16px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {r.roles.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-sm font-semibold text-tdn">Failed to load roles</p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {r.roles.isSuccess && r.roleList.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-12 text-center">
          <p className="text-sm font-bold text-ink">No roles defined</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Create a role to grant console permissions.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {r.roles.isSuccess && r.roleList.length > 0 && (
        <>
          <RolesTable roles={r.roleList} onEdit={r.openEdit} />
          <RoleAccessMatrix roles={r.roleList} />
        </>
      )}

      {r.open && (
        <RoleEditorDialog
          // Remount per target so the editor's internal state re-seeds.
          key={r.editing?.id ?? "create"}
          open={r.open}
          onOpenChange={r.setOpen}
          role={r.editing}
        />
      )}
    </div>
  )
}
