"use client"

/**
 * RolePermissionMatrix — the "Role permission matrix" card from the Operator
 * Console design (`docs/design-ref/screens/Admins.html`, spec §6.15). A
 * horizontally-scrollable grid: one row per permission category, one column per
 * role, each cell an access-level icon tile (full-access / read-only / no-access)
 * with a legend below.
 *
 * DATA is REAL and derived: the columns come from `useRoles()` (built-in +
 * custom) and each cell's level is computed from the role's granted
 * `permissionIds` against the `usePermissions()` catalog — a category is
 * "full" when the role holds any write/execute/delete action there, "read" when
 * it holds only reads, "none" otherwise. The access level (not colour alone) is
 * the signal: each level carries a distinct icon + hover title.
 */
import { useMemo } from "react"
import {
  ADMIN_PERMISSION_CATEGORIES,
  type AdminPermissionRecord,
  type Role,
} from "@handshake-agent/contracts"

import type {
  PermissionMatrixLevel,
  PermissionMatrixRow,
  RolePermissionMatrixProps,
} from "@/types/components"

// The actions that count as "elevated" (beyond read) for the full/read split.
const ELEVATED_ACTIONS: ReadonlySet<AdminPermissionRecord["action"]> = new Set([
  "write",
  "execute",
  "delete",
])

// Access-level → the icon-tile presentation (design line 12 + legend line 14).
// SVG path `d` per level; tokens map to the same s*/t* pairs as the pills.
const LEVEL_META: Record<
  PermissionMatrixLevel,
  { title: string; tile: string; icon: string }
> = {
  full: {
    title: "Full access",
    tile: "bg-sok text-tok",
    icon: "m5 12 5 5L20 7",
  },
  read: {
    title: "Read-only",
    tile: "bg-sif text-tif",
    icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z",
  },
  none: {
    title: "No access",
    tile: "bg-card2 text-ink3",
    icon: "M6 6l12 12M18 6L6 18",
  },
}

/** The access level a role has for one permission category. */
function levelFor(
  role: Role,
  category: string,
  permissions: AdminPermissionRecord[]
): PermissionMatrixLevel {
  const granted = new Set(role.permissionIds)
  let hasRead = false
  for (const perm of permissions) {
    if (perm.category !== category) continue
    if (!granted.has(perm.id)) continue
    if (ELEVATED_ACTIONS.has(perm.action)) return "full"
    hasRead = true
  }
  return hasRead ? "read" : "none"
}

/** Format a role name for a column header (snake_case → Title Case). */
function roleLabel(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function RolePermissionMatrix({
  roles,
  permissions,
}: RolePermissionMatrixProps) {
  // Only categories that appear in the catalog get a row (keeps the matrix in
  // step with whatever surfaces are registered this deploy).
  const rows = useMemo<PermissionMatrixRow[]>(() => {
    const present = new Set(permissions.map((p) => p.category))
    return ADMIN_PERMISSION_CATEGORIES.filter((c) => present.has(c)).map(
      (category) => ({
        label: category,
        cells: roles.map((role) => levelFor(role, category, permissions)),
      })
    )
  }, [roles, permissions])

  // The header + every row share this grid: a category label column + one 1fr
  // column per role (design line 11: `1.4fr repeat(6,1fr)`, generalised to N).
  const gridTemplate = {
    gridTemplateColumns: `1.4fr repeat(${roles.length}, minmax(0, 1fr))`,
  }

  return (
    <div className="scr overflow-x-auto rounded-[16px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-3.5 text-[13px] font-extrabold text-ink">
        Role permission matrix
      </div>

      <div className="min-w-[640px]">
        {/* Header row — role columns */}
        <div
          style={gridTemplate}
          className="grid gap-2 border-b border-line pb-2.5"
        >
          <div />
          {roles.map((role) => (
            <div
              key={role.id}
              className="text-center text-[10px] leading-[1.2] font-bold text-ink3"
              title={role.description}
            >
              {roleLabel(role.name)}
            </div>
          ))}
        </div>

        {/* Capability rows */}
        {rows.map((row) => (
          <div
            key={row.label}
            style={gridTemplate}
            className="grid items-center gap-2 border-b border-line2 py-[11px] last:border-b-0"
          >
            <div className="text-[12.5px] font-bold text-ink">{row.label}</div>
            {row.cells.map((level, i) => {
              const meta = LEVEL_META[level]
              return (
                <div key={roles[i].id} className="flex justify-center">
                  <span
                    title={`${roleLabel(roles[i].name)} · ${row.label}: ${meta.title}`}
                    className={`flex size-6 items-center justify-center rounded-[7px] ${meta.tile}`}
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
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="sr-only">{meta.title}</span>
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Legend (design line 14) */}
      <div className="mt-3.5 flex flex-wrap gap-4">
        {(["full", "read", "none"] as const).map((level) => {
          const meta = LEVEL_META[level]
          return (
            <div
              key={level}
              className="flex items-center gap-1.5 text-[11px] text-ink2"
            >
              <span
                aria-hidden="true"
                className={`flex size-4 items-center justify-center rounded-[5px] ${meta.tile}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path
                    d={meta.icon}
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {meta.title}
            </div>
          )
        })}
      </div>
    </div>
  )
}
