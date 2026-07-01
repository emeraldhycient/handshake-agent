"use client"

/**
 * AdminsPage — the "Admins & roles" surface (Operator Console design
 * `docs/design-ref/screens/Admins.html`, spec §6.15), wired to real data.
 *
 * Reads (Phase 6a): the admin table comes from `useAdmins()`
 * (`AdminUserListResponse`), and the role permission matrix is derived live from
 * `useRoles()` (each role's granted `permissionIds`) × `usePermissions()` (the
 * permission catalog, grouped by category). Each cell's access level is computed
 * from the role's grants in that category: `full` if it holds any write / delete /
 * execute, `read` if only read, `none` otherwise — the same semantics the design's
 * `can()` matrix expressed, now sourced from the RBAC catalog rather than a mock.
 *
 * Layout is preserved 1:1: header (title + subtitle + dark "+ Invite admin" CTA)
 * → the admin table (Admin · Role · 2FA · Status · row actions) → the Role
 * permission matrix card (roles × capabilities, access-level icon tiles + legend).
 * Every async surface has four branches (loading / error / empty / data).
 *
 * WRITE actions stay untouched (Phase 7): "Reset 2FA" → step-up;
 * "Deactivate/Reactivate" → reason → maker-checker; "+ Invite admin" → the invite
 * dialog. This pass wires only the read display; no funds/DB side effects here.
 */
import { useMemo, useState } from "react"
import type {
  AdminPermissionRecord,
  AdminUser,
  Role,
} from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { InviteAdminDialog } from "@/components/admin/invite-admin-dialog"
import { useAdmins, usePermissions, useRoles } from "@/lib/query/hooks"
import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"

// ─── Brand + status constants (mapped to design tokens; §1.3 / stMeta) ─────────

/** Admin/operator striped avatar (§1.3) — brand-green diagonal stripes. */
const AVATAR_STRIPE =
  "repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)"

/**
 * The design's role-dot palette (`roleMeta()`, logic.js 168-173). Roles now
 * arrive by display name, not a fixed slug, so a role's dot colour is assigned by
 * hashing its name into this palette — deterministic per role, design-consistent
 * tokens, and stable across renders.
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

/** Two-letter initials from an admin's email local-part (no name on the DTO). */
function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? ""
  const parts = local.split(/[.\-_+]/).filter(Boolean)
  const chars =
    parts.length >= 2
      ? parts[0][0] + parts[1][0]
      : local.slice(0, 2).padEnd(2, local.slice(0, 1) || "?")
  return chars.toUpperCase()
}

/** Shared grid template for the admin table header + every body row (design 5/6). */
const ADMIN_GRID = "grid-cols-[1.6fr_1.3fr_0.8fr_0.9fr_1.2fr] gap-3 px-[18px]"

// ─── Role permission matrix (design lines 9-14) ────────────────────────────────

/**
 * Access level per matrix cell → its icon tile (design line 12/14): full-access
 * (check, `--sok`/`--tok`), read-only (eye, `--sif`/`--tif`), no-access (cross,
 * `--card2`/`--ink3`). The label beside each column + the title tooltip carry the
 * meaning, so colour is never the sole signal.
 */
type Access = "full" | "read" | "none"

const ACCESS_META: Record<
  Access,
  { icon: string; bg: string; fg: string; title: string; strokeWidth: number }
> = {
  full: {
    icon: "m5 12 5 5L20 7",
    bg: "var(--sok,#e6f3ec)",
    fg: "var(--tok,#1f8a5b)",
    title: "Full access",
    strokeWidth: 2.4,
  },
  read: {
    icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z",
    bg: "var(--sif,#e9f0fd)",
    fg: "var(--tif,#3168e6)",
    title: "Read-only",
    strokeWidth: 2,
  },
  none: {
    icon: "M6 6l12 12M18 6L6 18",
    bg: "var(--card2,#faf8f2)",
    fg: "var(--ink3,#8b948a)",
    title: "No access",
    strokeWidth: 2.4,
  },
}

/** One capability row in the matrix — its label and the access level per role. */
interface MatrixRow {
  label: string
  cells: readonly Access[]
}

/** The derived matrix: role column labels + a row per permission category. */
interface MatrixData {
  cols: readonly string[]
  rows: readonly MatrixRow[]
}

/**
 * Reduce a set of granted actions in a category to one access level: `full` if any
 * write/delete/execute is held (the role can act), `read` if only reads are held,
 * `none` if nothing is granted there. This is the RBAC-backed equivalent of the
 * design's `can()` grant, computed from the live catalog + role assignments.
 */
function accessFromActions(actions: Set<string>): Access {
  if (actions.has("write") || actions.has("delete") || actions.has("execute")) {
    return "full"
  }
  if (actions.has("read")) return "read"
  return "none"
}

/**
 * Build the role × category access matrix from the catalog + roles. Columns are
 * the roles (in list order); rows are the catalog categories (in first-seen
 * order). For each (role, category) cell we gather the actions the role is granted
 * on that category's permissions and collapse them to an access level.
 */
function buildMatrix(
  roles: readonly Role[],
  permissions: readonly AdminPermissionRecord[]
): MatrixData {
  // Category → set of permission ids in that category (in catalog order).
  const categories: string[] = []
  const permsByCategory = new Map<string, string[]>()
  for (const perm of permissions) {
    if (!permsByCategory.has(perm.category)) {
      permsByCategory.set(perm.category, [])
      categories.push(perm.category)
    }
    permsByCategory.get(perm.category)!.push(perm.id)
    permsByCategory.get(perm.category)!.push(perm.action)
  }
  // Permission id → its action, for looking up a role's granted actions.
  const actionById = new Map<string, string>(
    permissions.map((p) => [p.id, p.action])
  )

  const rows: MatrixRow[] = categories.map((category) => {
    const idsInCategory = permissions
      .filter((p) => p.category === category)
      .map((p) => p.id)
    const cells: Access[] = roles.map((role) => {
      const granted = new Set(role.permissionIds)
      const actions = new Set<string>()
      for (const id of idsInCategory) {
        if (granted.has(id)) {
          const action = actionById.get(id)
          if (action) actions.add(action)
        }
      }
      return accessFromActions(actions)
    })
    return { label: category, cells }
  })

  return { cols: roles.map((role) => role.name), rows }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

/** The four flow steps a row action can currently be waiting on. */
type ActiveFlow = "reason" | "maker" | "stepUp" | null

export function AdminsPage() {
  const [inviteOpen, setInviteOpen] = useState(false)

  const adminsQuery = useAdmins()
  const rolesQuery = useRoles()
  const permissionsQuery = usePermissions()

  const admins = adminsQuery.data?.items ?? []
  const roles = rolesQuery.data?.roles ?? []

  // Derive the role × category access matrix once per roles/permissions change.
  const matrix = useMemo<MatrixData | null>(() => {
    if (!rolesQuery.data || !permissionsQuery.data) return null
    return buildMatrix(rolesQuery.data.roles, permissionsQuery.data.permissions)
  }, [rolesQuery.data, permissionsQuery.data])

  const matrixLoading = rolesQuery.isLoading || permissionsQuery.isLoading
  const matrixError = rolesQuery.isError || permissionsQuery.isError

  // The row-action flow. "Deactivate/Reactivate" runs reason → maker-checker;
  // "Reset 2FA" runs step-up directly. Presentation only (Phase 7 wires writes).
  const [flow, setFlow] = useState<ActiveFlow>(null)
  const [flowAdmin, setFlowAdmin] = useState<AdminUser | null>(null)

  function closeFlow() {
    setFlow(null)
    setFlowAdmin(null)
  }

  const flowAdminActive = flowAdmin?.status === "active"
  const flowActionLabel =
    flowAdmin && (flowAdminActive ? "Deactivate admin" : "Reactivate admin")

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
            <AdminRow
              key={admin.id}
              admin={admin}
              onReset2fa={() => {
                setFlowAdmin(admin)
                setFlow("stepUp")
              }}
              onToggleActive={() => {
                setFlowAdmin(admin)
                setFlow("reason")
              }}
            />
          ))}
      </div>

      {/* ── Role permission matrix ─────────────────────────────────────────── */}
      <div className="scr overflow-x-auto rounded-[16px] border border-line bg-card px-[20px] py-[18px]">
        <div className="mb-[14px] text-[13px] font-extrabold text-ink">
          Role permission matrix
        </div>

        {/* Loading */}
        {matrixLoading && (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-full rounded-[8px]" />
            ))}
          </div>
        )}

        {/* Error */}
        {!matrixLoading && matrixError && (
          <div className="py-8 text-center">
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

        {/* Empty */}
        {!matrixLoading &&
          !matrixError &&
          matrix &&
          (matrix.cols.length === 0 || matrix.rows.length === 0) && (
            <div className="py-8 text-center text-ink3">
              <div className="text-[13.5px] font-bold text-ink2">
                No roles to display
              </div>
            </div>
          )}

        {/* Data */}
        {!matrixLoading &&
          !matrixError &&
          matrix &&
          matrix.cols.length > 0 &&
          matrix.rows.length > 0 && (
            <>
              <div className="min-w-[640px]">
                {/* Column header */}
                <div
                  className="grid gap-2 border-b border-line pb-[10px]"
                  style={{
                    gridTemplateColumns: `1.4fr repeat(${matrix.cols.length}, 1fr)`,
                  }}
                >
                  <div />
                  {matrix.cols.map((c) => (
                    <div
                      key={c}
                      className="text-center text-[10px] leading-[1.2] font-bold text-ink3"
                    >
                      {c}
                    </div>
                  ))}
                </div>

                {/* Capability rows */}
                {matrix.rows.map((row) => (
                  <div
                    key={row.label}
                    className="grid items-center gap-2 border-b border-line2 py-[11px] last:border-b-0"
                    style={{
                      gridTemplateColumns: `1.4fr repeat(${matrix.cols.length}, 1fr)`,
                    }}
                  >
                    <div className="text-[12.5px] font-bold text-ink">
                      {row.label}
                    </div>
                    {row.cells.map((access, i) => {
                      const meta = ACCESS_META[access]
                      return (
                        <div
                          key={`${row.label}-${matrix.cols[i]}`}
                          className="flex justify-center"
                        >
                          <span
                            title={`${matrix.cols[i]} · ${meta.title}`}
                            className="flex size-6 items-center justify-center rounded-[7px]"
                            style={{ background: meta.bg, color: meta.fg }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d={meta.icon}
                                stroke="currentColor"
                                strokeWidth={meta.strokeWidth}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="mt-[14px] flex flex-wrap gap-4">
                <LegendItem
                  bg="var(--sok,#e6f3ec)"
                  fg="var(--tok,#1f8a5b)"
                  icon="m5 12 5 5L20 7"
                  strokeWidth={2.4}
                  label="Full access"
                />
                <LegendItem
                  bg="var(--sif,#e9f0fd)"
                  fg="var(--tif,#3168e6)"
                  icon="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
                  strokeWidth={2}
                  label="Read-only"
                />
                <LegendItem
                  bg="var(--card2,#faf8f2)"
                  fg="var(--ink3,#8b948a)"
                  icon="M6 6l12 12M18 6L6 18"
                  strokeWidth={2.4}
                  label="No access"
                />
              </div>
            </>
          )}
      </div>

      {/* ── Flow modals (Reset 2FA · Deactivate/Reactivate · Invite) ───────── */}
      <ReasonModal
        open={flow === "reason"}
        onOpenChange={(open) => {
          if (!open) closeFlow()
        }}
        title={flowActionLabel ?? "Change admin status"}
        onContinue={() => setFlow("maker")}
      />
      <MakerCheckerModal
        open={flow === "maker"}
        onOpenChange={(open) => {
          if (!open) closeFlow()
        }}
        title={flowActionLabel ?? "Change admin status"}
        diff={
          flowAdmin
            ? [
                {
                  field: `Admin: ${flowAdmin.email}`,
                  from: flowAdminActive ? "Active" : "Deactivated",
                  to: flowAdminActive ? "Deactivated" : "Active",
                },
              ]
            : []
        }
        onSubmit={closeFlow}
      />
      <StepUpModal
        open={flow === "stepUp"}
        onOpenChange={(open) => {
          if (!open) closeFlow()
        }}
        title={flowAdmin ? `Reset 2FA for ${flowAdmin.email}` : "Reset 2FA"}
        onComplete={closeFlow}
      />

      <InviteAdminDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles}
      />
    </div>
  )
}

/** One admin table row (design line 6). */
function AdminRow({
  admin,
  onReset2fa,
  onToggleActive,
}: {
  admin: AdminUser
  onReset2fa: () => void
  onToggleActive: () => void
}) {
  // No display name on the DTO — the email local-part stands in as the name.
  const displayName = admin.email.split("@")[0] ?? admin.email
  const isActive = admin.status === "active"
  const actionLabel = isActive ? "Deactivate" : "Reactivate"
  return (
    <div
      className={cn(
        "grid items-center border-b border-line2 py-[13px] last:border-b-0",
        ADMIN_GRID
      )}
    >
      {/* Admin — striped avatar (initials from email) + name + email */}
      <div className="flex min-w-0 items-center gap-[11px]">
        <span
          aria-hidden="true"
          className="flex size-8 flex-none items-center justify-center rounded-full text-[11px] font-extrabold text-white"
          style={{ background: AVATAR_STRIPE }}
        >
          {emailInitials(admin.email)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-ink">
            {displayName}
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

      {/* Row actions */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onReset2fa}
          className="text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Reset 2FA
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          className="text-[11.5px] font-bold text-ink3 transition-colors hover:text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}

/** One legend swatch under the matrix (design line 14). */
function LegendItem({
  bg,
  fg,
  icon,
  strokeWidth,
  label,
}: {
  bg: string
  fg: string
  icon: string
  strokeWidth: number
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink2">
      <span
        className="flex size-4 items-center justify-center rounded-[5px]"
        style={{ background: bg, color: fg }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d={icon}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {label}
    </div>
  )
}
