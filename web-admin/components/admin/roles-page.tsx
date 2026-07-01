"use client"

/**
 * RolesPage — list roles and create / edit them via the permission-matrix
 * editor, plus a read-only **role permission matrix** (categories × roles,
 * cells = full-access / read-only / no-access) derived from each role's granted
 * permission ids against the static PERMISSION_CATALOG. Built-in roles open
 * read-only (the editor disables every control). Four async branches on the
 * roles query: loading / error / empty / data.
 */
import { useMemo, useState, type CSSProperties } from "react"
import { Check, Eye, Plus, X } from "lucide-react"
import {
  ADMIN_PERMISSION_CATEGORIES,
  PERMISSION_CATALOG,
  permissionId,
  type AdminPermissionCategory,
  type Role,
} from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { RoleEditorDialog } from "@/components/admin/role-editor-dialog"
import { useRoles } from "@/lib/query/hooks"

/** Access level a role holds over a permission category. */
type AccessLevel = "full" | "read" | "none"

// Catalog entry ids grouped by category, computed once (static constant).
const CATALOG_BY_CATEGORY: ReadonlyMap<AdminPermissionCategory, string[]> =
  (() => {
    const map = new Map<AdminPermissionCategory, string[]>()
    for (const entry of PERMISSION_CATALOG) {
      const ids = map.get(entry.category) ?? []
      ids.push(permissionId(entry))
      map.set(entry.category, ids)
    }
    return map
  })()

// Categories that have at least one catalog entry — the matrix rows.
const MATRIX_CATEGORIES = ADMIN_PERMISSION_CATEGORIES.filter((c) =>
  CATALOG_BY_CATEGORY.has(c)
)

/**
 * Resolve a role's access level for a category: `full` if it grants any
 * non-read action, `read` if it grants only read actions, else `none`. Read
 * vs. write is inferred from the permission id's trailing `:action` segment.
 */
function accessLevel(
  role: Role,
  category: AdminPermissionCategory
): AccessLevel {
  const granted = new Set(role.permissionIds)
  const ids = CATALOG_BY_CATEGORY.get(category) ?? []
  let sawRead = false
  for (const id of ids) {
    if (!granted.has(id)) continue
    if (id.endsWith(":read")) sawRead = true
    else return "full"
  }
  return sawRead ? "read" : "none"
}

const ACCESS_META: Record<
  AccessLevel,
  { label: string; tile: string; Icon: typeof Check }
> = {
  full: { label: "Full access", tile: "bg-sok text-tok", Icon: Check },
  read: { label: "Read-only", tile: "bg-sif text-tif", Icon: Eye },
  none: { label: "No access", tile: "bg-card2 text-ink3", Icon: X },
}

function AccessTile({ level }: { level: AccessLevel }) {
  const { label, tile, Icon } = ACCESS_META[level]
  return (
    <span
      title={label}
      className={`flex size-6 items-center justify-center rounded-[7px] ${tile}`}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

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

  const roleList = roles.data?.roles ?? []
  // Grid template is data-driven (one column per role), so it must be an inline
  // style — Tailwind's JIT cannot see a runtime-built arbitrary class.
  const matrixGrid = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: `1.4fr repeat(${roleList.length}, minmax(0, 1fr))`,
    }),
    [roleList.length]
  )

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
        <Button size="sm" onClick={openCreate}>
          <Plus aria-hidden="true" />
          New role
        </Button>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {roles.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-[16px]" />
          <Skeleton className="h-12 w-full rounded-[16px]" />
          <Skeleton className="h-40 w-full rounded-[16px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {roles.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-sm font-semibold text-tdn">Failed to load roles</p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {roles.isSuccess && roleList.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-12 text-center">
          <p className="text-sm font-bold text-ink">No roles defined</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Create a role to grant console permissions.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {roles.isSuccess && roleList.length > 0 && (
        <>
          {/* Roles table */}
          <div className="overflow-hidden rounded-[16px] border border-line bg-card">
            <div className="grid grid-cols-[1.6fr_1.6fr_0.8fr_0.9fr] gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase">
              <div>Name</div>
              <div>Description</div>
              <div>Permissions</div>
              <div className="text-right" />
            </div>
            {roleList.map((role) => (
              <div
                key={role.id}
                className="grid grid-cols-[1.6fr_1.6fr_0.8fr_0.9fr] items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[12.5px] font-bold text-ink">
                    {role.name}
                  </span>
                  {role.isBuiltin && <Badge variant="neutral">built-in</Badge>}
                </div>
                <div className="truncate text-[12px] text-ink2">
                  {role.description}
                </div>
                <div className="font-mono text-[12px] text-ink2 tabular-nums">
                  {role.permissionIds.length}
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(role)}
                  >
                    {role.isBuiltin ? "View" : "Edit"}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Role permission matrix */}
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
                  {roleList.map((role) => (
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
                    <div className="text-[12.5px] font-bold text-ink">
                      {category}
                    </div>
                    {roleList.map((role) => (
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
        </>
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
