"use client"

/**
 * RolePermissionMatrix — the "Role permission matrix" card (design §6.15). Composition
 * only: the columns come from the roles + the per-cell access level is derived from each
 * role's granted `permissionIds` against the permissions catalog (`buildMatrixRows` /
 * `levelFor` in `lib/roles/permission-matrix`). A horizontally-scrollable grid: one row
 * per permission category, one column per role, each cell an access-level icon tile
 * (full / read / none) with a legend below — the level (not colour alone) is the signal.
 */
import { useMemo } from "react"

import { buildMatrixRows, roleLabel } from "@/lib/roles/permission-matrix"
import { LEVEL_META } from "@/constants/role-matrix"
import type { RolePermissionMatrixProps } from "@/types/components"

export function RolePermissionMatrix({
  roles,
  permissions,
}: RolePermissionMatrixProps) {
  const rows = useMemo(
    () => buildMatrixRows(roles, permissions),
    [roles, permissions]
  )

  // The header + every row share this grid: a category label column + one 1fr column per
  // role (design line 11: `1.4fr repeat(6,1fr)`, generalised to N).
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
