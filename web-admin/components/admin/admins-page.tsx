"use client"

/**
 * AdminsPage — the "Admins & roles" surface (design §6.15). Composition only:
 * `useAdminsPage` owns the three reads (admins / roles / permissions), the derived
 * matrix branch flags, and the dialog state; the table, rows, and matrix section live
 * in `components/admin/admins/*`. Every sensitive write routes through the shared
 * step-up-gated components (AdminRowActions, RoleEditorDialog, InviteAdminDialog) —
 * RBAC writes only, no funds move (§3.1); resetting 2FA reveals no secret.
 */
import { InviteAdminDialog } from "@/components/admin/invite-admin-dialog"
import { RoleEditorDialog } from "@/components/admin/role-editor-dialog"
import { PageHeader } from "@/components/admin/page-header"
import { AdminsTable } from "@/components/admin/admins/admins-table"
import { RoleMatrixSection } from "@/components/admin/admins/role-matrix-section"
import { useAdminsPage } from "@/lib/hooks/use-admins-page"

export function AdminsPage() {
  const a = useAdminsPage()

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Admins & roles"
        subtitle="Admin users, the role permission matrix, and session policy."
        actions={
          <button
            type="button"
            onClick={() => a.setInviteOpen(true)}
            className="flex h-[38px] items-center gap-[7px] rounded-[11px] bg-btn-dark px-[15px] text-[12.5px] font-bold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            + Invite admin
          </button>
        }
      />

      {/* ── Admin table ────────────────────────────────────────────────────── */}
      <AdminsTable
        isLoading={a.adminsQuery.isLoading}
        isError={a.adminsQuery.isError}
        isSuccess={a.adminsQuery.isSuccess}
        admins={a.admins}
        roles={a.roles}
        onRetry={() => void a.adminsQuery.refetch()}
      />

      {/* ── Role permission matrix (shared component) ──────────────────────── */}
      <RoleMatrixSection
        loading={a.matrixLoading}
        error={a.matrixError}
        ready={a.matrixReady}
        empty={a.matrixEmpty}
        roles={a.roles}
        permissions={a.permissions}
        onCreateRole={a.openCreateRole}
        onRetry={a.retryMatrix}
      />

      {/* ── Role editor (create / edit permissions) · Invite ───────────────── */}
      {a.roleEditorOpen && (
        <RoleEditorDialog
          // Remount per target so the editor's internal state re-seeds.
          key={a.roleEdit?.id ?? "create"}
          open={a.roleEditorOpen}
          onOpenChange={a.setRoleEditorOpen}
          role={a.roleEdit}
        />
      )}

      <InviteAdminDialog
        open={a.inviteOpen}
        onOpenChange={a.setInviteOpen}
        roles={a.roles}
      />
    </div>
  )
}
