"use client"

/**
 * AdminsPage — the "Admins & roles" surface (Operator Console design
 * `docs/design-ref/screens/Admins.html`, spec §6.15), wired to real data.
 *
 * Reads: the admin table comes from `useAdmins()` (`AdminUserListResponse`) and the
 * role permission matrix is the shared `RolePermissionMatrix` component, fed the live
 * `useRoles()` (each role's granted `permissionIds`) × `usePermissions()` (the
 * permission catalog). Each admin's `displayName` (the contract field) is the primary
 * row label with the email as the sub-row. Every async surface has four branches
 * (loading / error / empty / data).
 *
 * WRITE actions are wired through the canonical step-up-gated components so the reason
 * → step-up → mutation → invalidate chain lives in one place (§13.1 / §3.4):
 *  - per-row change-role / suspend-reactivate-offboard → `AdminRowActions`
 *    (useUpdateAdminRole / useSetAdminStatus);
 *  - per-row "Reset 2FA" → `AdminResetMfaAction`, which chains ReasonModal (audited) →
 *    StepUpModal (TOTP) → `useResetAdminMfa`, replaying through `StepUpDialog` on a
 *    server 403 ADMIN_STEP_UP_REQUIRED (the sanctions-page pattern);
 *  - create-role / edit-role-permissions → `RoleEditorDialog`;
 *  - "+ Invite admin" → `InviteAdminDialog`.
 * Each mutation invalidates its query key so the table + matrix re-resolve. No LLM
 * output and no funds move — RBAC writes only (§3.1); resetting 2FA reveals no secret.
 */
import { useState } from "react"
import type { AdminUser, Role } from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { InviteAdminDialog } from "@/components/admin/invite-admin-dialog"
import { AdminRowActions } from "@/components/admin/admin-row-actions"
import { AdminResetMfaAction } from "@/components/admin/admin-reset-mfa-action"
import { RoleEditorDialog } from "@/components/admin/role-editor-dialog"
import { RolePermissionMatrix } from "@/components/admin/role-permission-matrix"
import { useAdmins, usePermissions, useRoles } from "@/lib/query/hooks"

// ─── Brand + status constants (mapped to design tokens; §1.3 / stMeta) ─────────

/** Admin/operator striped avatar (§1.3) — brand-green diagonal stripes. */
const AVATAR_STRIPE =
  "repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)"

/**
 * The design's role-dot palette (`roleMeta()`, logic.js 168-173). Roles arrive by
 * display name, not a fixed slug, so a role's dot colour is assigned by hashing its
 * name into this palette — deterministic per role, design-consistent tokens, and
 * stable across renders.
 */
const ROLE_DOT_PALETTE: readonly string[] = [
  "var(--brand-amber)",
  "var(--tif)",
  "var(--tok)",
  "#8a4b8a",
  "#c07a2a",
  "var(--ink3)",
]

/** Deterministic role-dot colour from the role name (stable palette index). */
function roleDot(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return ROLE_DOT_PALETTE[hash % ROLE_DOT_PALETTE.length]
}

/** Two-letter initials from an admin's display name (first + last word, or first two
 *  chars of a single word). Falls back to "?" for an empty name. */
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  const single = parts[0] ?? ""
  return (single.slice(0, 2) || "?").toUpperCase()
}

/** Shared grid template for the admin table header + every body row (design 5/6).
 * The last column hosts the wired row-actions (role select + status + reset-2FA), so
 * it is given more room than the design's original text-only actions column. */
const ADMIN_GRID = "grid-cols-[1.4fr_1fr_0.7fr_0.8fr_2.4fr] gap-3 px-[18px]"

// ─── Page ──────────────────────────────────────────────────────────────────────

export function AdminsPage() {
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

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Admins &amp; roles
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Admin users, the role permission matrix, and session policy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex h-[38px] items-center gap-[7px] rounded-[11px] bg-btn-dark px-[15px] text-[12.5px] font-bold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          + Invite admin
        </button>
      </div>

      {/* ── Admin table ────────────────────────────────────────────────────── */}
      <div className="mb-4 overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Header row */}
        <div
          className={cn(
            "grid border-b border-line bg-card2 py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
            ADMIN_GRID
          )}
        >
          <div>Admin</div>
          <div>Role</div>
          <div>2FA</div>
          <div>Status</div>
          <div aria-hidden="true" />
        </div>

        {/* Loading */}
        {adminsQuery.isLoading && (
          <div className="py-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  "grid items-center border-b border-line2 py-[13px] last:border-b-0",
                  ADMIN_GRID
                )}
              >
                <div className="flex items-center gap-[11px]">
                  <Skeleton className="size-8 flex-none rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="mt-1.5 h-2.5 w-40" />
                  </div>
                </div>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-4 w-16 rounded-full" />
                <div />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {adminsQuery.isError && (
          <div className="px-5 py-[46px] text-center">
            <div className="text-[13.5px] font-bold text-tdn">
              Couldn&apos;t load admins
            </div>
            <button
              type="button"
              onClick={() => void adminsQuery.refetch()}
              className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty */}
        {adminsQuery.isSuccess && admins.length === 0 && (
          <div className="px-5 py-[46px] text-center text-ink3">
            <div className="text-[14px] font-bold text-ink2">No admins yet</div>
            <div className="mt-1 text-[12.5px]">
              Invite your first operator to get started.
            </div>
          </div>
        )}

        {/* Data */}
        {adminsQuery.isSuccess &&
          admins.map((admin) => (
            <AdminRow key={admin.id} admin={admin} roles={roles} />
          ))}
      </div>

      {/* ── Role permission matrix (shared component) ──────────────────────── */}
      <div className="mb-1 flex items-center justify-end">
        <button
          type="button"
          onClick={openCreateRole}
          className="flex h-[32px] items-center gap-[6px] rounded-[10px] border border-line bg-card px-3 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          + New role
        </button>
      </div>

      {matrixLoading && (
        <div
          className="rounded-[16px] border border-line bg-card px-5 py-[18px]"
          aria-busy="true"
        >
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-full rounded-[8px]" />
            ))}
          </div>
        </div>
      )}

      {!matrixLoading && matrixError && (
        <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center">
          <div className="text-[13.5px] font-bold text-tdn">
            Couldn&apos;t load the permission matrix
          </div>
          <button
            type="button"
            onClick={() => {
              void rolesQuery.refetch()
              void permissionsQuery.refetch()
            }}
            className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      )}

      {!matrixLoading && !matrixError && matrixEmpty && (
        <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center text-ink3">
          <div className="text-[13.5px] font-bold text-ink2">
            No roles to display
          </div>
        </div>
      )}

      {!matrixLoading && !matrixError && matrixReady && !matrixEmpty && (
        <RolePermissionMatrix roles={roles} permissions={permissions} />
      )}

      {/* ── Role editor (create / edit permissions) · Invite ───────────────── */}
      {roleEditorOpen && (
        <RoleEditorDialog
          // Remount per target so the editor's internal state re-seeds.
          key={roleEdit?.id ?? "create"}
          open={roleEditorOpen}
          onOpenChange={setRoleEditorOpen}
          role={roleEdit}
        />
      )}

      <InviteAdminDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles}
      />
    </div>
  )
}

/**
 * One admin table row (design line 6). The sensitive row actions (change role,
 * suspend / reactivate / offboard) are the wired `AdminRowActions`; "Reset 2FA" is
 * `AdminResetMfaAction` — both run their step-up-gated mutations and invalidate the
 * admins query on success. The `displayName` is the primary label with the email
 * beneath it.
 */
function AdminRow({ admin, roles }: { admin: AdminUser; roles: Role[] }) {
  const isActive = admin.status === "active"
  return (
    <div
      className={cn(
        "grid items-center border-b border-line2 py-[13px] last:border-b-0",
        ADMIN_GRID
      )}
    >
      {/* Admin — striped avatar (initials from the display name) + name + email */}
      <div className="flex min-w-0 items-center gap-[11px]">
        <span
          aria-hidden="true"
          className="flex size-8 flex-none items-center justify-center rounded-full text-[11px] font-extrabold text-white"
          style={{ background: AVATAR_STRIPE }}
        >
          {nameInitials(admin.displayName)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-ink">
            {admin.displayName}
          </div>
          <div className="truncate text-[11px] text-ink3">{admin.email}</div>
        </div>
      </div>

      {/* Role — dot + label */}
      <div>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-ink">
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full"
            style={{ background: roleDot(admin.role.name) }}
          />
          {admin.role.name}
        </span>
      </div>

      {/* 2FA — enrolment state (label carries the meaning, not just colour) */}
      <div>
        {admin.mfaEnabled ? (
          <span className="text-[11px] font-bold text-tok">Enrolled</span>
        ) : (
          <span className="text-[11px] font-bold text-ink3">Not set</span>
        )}
      </div>

      {/* Status pill */}
      <div>
        {isActive ? (
          <span className="rounded-full bg-sok px-[9px] py-[2px] text-[10.5px] font-bold text-tok">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-card2 px-[9px] py-[2px] text-[10.5px] font-bold text-ink2 capitalize">
            {admin.status}
          </span>
        )}
      </div>

      {/* Row actions — change role + suspend/reactivate/offboard + reset 2FA
          (all step-up-gated) */}
      <div className="flex items-center justify-end gap-2">
        <AdminResetMfaAction admin={admin} />
        <AdminRowActions admin={admin} roles={roles} />
      </div>
    </div>
  )
}
