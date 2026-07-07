import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { RolesTableProps } from "@/types/components"

/**
 * The roles table — one row per role (name + built-in badge · description · granted
 * permission count · a View (built-in, read-only) / Edit action that opens the editor).
 */
export function RolesTable({ roles, onEdit }: RolesTableProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <div className="grid grid-cols-[1.6fr_1.6fr_0.8fr_0.9fr] gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase">
        <div>Name</div>
        <div>Description</div>
        <div>Permissions</div>
        <div className="text-right" />
      </div>
      {roles.map((role) => (
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
            <Button size="sm" variant="outline" onClick={() => onEdit(role)}>
              {role.isBuiltin ? "View" : "Edit"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
