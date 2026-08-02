"use client"

/**
 * RoleEditorDialog — create or edit a role with a permission-matrix editor. Composition
 * only: `useRoleEditor` owns the name/description/selected-permission state + the
 * create/update save; the editable matrix is `PermissionMatrixEditor`. Built-in roles
 * are read-only (every control disabled). RBAC writes only — no funds move (§3.1).
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { PermissionMatrixEditor } from "@/components/admin/roles/permission-matrix-editor"
import { useRoleEditor } from "@/lib/hooks/use-role-editor"
import type { RoleEditorDialogProps } from "@/types"

export function RoleEditorDialog({
  open,
  onOpenChange,
  role,
}: RoleEditorDialogProps) {
  const r = useRoleEditor(role, onOpenChange)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {r.isEditing ? `Edit role: ${role?.name}` : "Create role"}
          </DialogTitle>
          <DialogDescription>
            {r.readOnly
              ? "This is a built-in role and cannot be modified."
              : "Select the permissions this role grants."}
          </DialogDescription>
        </DialogHeader>

        {r.serverError && (
          <div
            role="alert"
            className="rounded-[12px] border border-sdn bg-sdn/40 px-4 py-3 text-sm text-tdn"
          >
            {r.serverError}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {!r.isEditing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={r.name}
                onChange={(e) => r.setName(e.target.value)}
                placeholder="e.g. analyst"
                disabled={r.loading}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={r.description}
              onChange={(e) => r.setDescription(e.target.value)}
              placeholder="What this role is for"
              disabled={r.loading || r.readOnly}
            />
          </div>

          {/* ── Permission matrix ──────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-extrabold text-ink">Permissions</p>
            <Badge variant={r.selectedCount > 0 ? "info" : "neutral"}>
              {r.selectedCount} selected
            </Badge>
          </div>

          <PermissionMatrixEditor
            selected={r.selected}
            onToggle={r.toggle}
            disabled={r.readOnly || r.loading}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={r.loading}
          >
            {r.readOnly ? "Close" : "Cancel"}
          </Button>
          {!r.readOnly && (
            <Button
              onClick={r.onSave}
              disabled={r.loading}
              aria-busy={r.loading}
            >
              {r.loading
                ? "Saving…"
                : r.isEditing
                  ? "Save changes"
                  : "Create role"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
