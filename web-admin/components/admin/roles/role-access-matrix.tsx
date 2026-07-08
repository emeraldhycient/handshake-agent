import { useMemo, type CSSProperties } from "react"

import { accessLevel, MATRIX_CATEGORIES } from "@/lib/roles/access"
import type { RoleAccessMatrixProps } from "@/types/components"

import { AccessTile, ACCESS_META } from "./access-tile"

/**
 * The read-only role permission matrix — categories (rows) × roles (columns) of access
 * tiles, each cell the effective access `accessLevel(role, category)` derives from the
 * role's granted permission ids. A legend restates the three tones (colour is never the
 * sole signal). The grid template is data-driven (one column per role → inline style).
 */
export function RoleAccessMatrix({ roles }: RoleAccessMatrixProps) {
  const matrixGrid = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: `1.4fr repeat(${roles.length}, minmax(0, 1fr))`,
    }),
    [roles.length]
  )

  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[13px] font-extrabold text-ink">
          Role permission matrix
        </h2>
        <p className="mt-1 text-[11.5px] text-ink3">
          Effective access each role holds, by capability category.
        </p>
      </div>
      <div className="overflow-x-auto px-5 py-4">
        <div className="min-w-[640px]">
          {/* Column headers — role names */}
          <div
            className="grid gap-2 border-b border-line pb-2.5"
            style={matrixGrid}
          >
            <div />
            {roles.map((role) => (
              <div
                key={role.id}
                className="truncate text-center text-[10px] font-bold text-ink3"
                title={role.name}
              >
                {role.name}
              </div>
            ))}
          </div>
          {/* One row per category */}
          {MATRIX_CATEGORIES.map((category) => (
            <div
              key={category}
              className="grid items-center gap-2 border-b border-line2 py-2.5 last:border-b-0"
              style={matrixGrid}
            >
              <div className="text-[12.5px] font-bold text-ink">{category}</div>
              {roles.map((role) => (
                <div key={role.id} className="flex justify-center">
                  <AccessTile level={accessLevel(role, category)} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-3.5 flex flex-wrap gap-4">
          {(["full", "read", "none"] as const).map((level) => {
            const { label, tile, Icon } = ACCESS_META[level]
            return (
              <div
                key={level}
                className="flex items-center gap-1.5 text-[11px] text-ink2"
              >
                <span
                  className={`flex size-4 items-center justify-center rounded-[5px] ${tile}`}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-2.5"
                    strokeWidth={2.6}
                  />
                </span>
                {label}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
