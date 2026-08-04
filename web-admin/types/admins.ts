/** Admins + roles pages (RBAC operator management). */

import type {
  AdminPermissionRecord,
  AdminUser,
  Role,
} from "@handshake-agent/contracts"

// ─── Admins page ─────────────────────────────────────────────────────────────────

export interface InviteAdminDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: Role[]
}

/** The post-invite success view: the one-time invitation token shown once. */
export interface InviteSuccessProps {
  email: string
  token: string
  onDone: () => void
}

export interface AdminRowActionsProps {
  admin: AdminUser
  roles: Role[]
}

/** The admin statuses an operator can transition another admin into. */
export type AdminSettableStatus = "active" | "suspended" | "offboarded"

/** One offered status transition (button label + the status it sets). */
export interface AdminStatusTransition {
  label: string
  status: AdminSettableStatus
}

/** One admin table row — striped avatar + identity, role dot, 2FA, status, actions. */
export interface AdminRowProps {
  admin: AdminUser
  roles: Role[]
}

/** The admin table card — header + the four async branches. */
export interface AdminsTableProps {
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  admins: readonly AdminUser[]
  roles: Role[]
  onRetry: () => void
}

/** The role permission matrix section — the "New role" CTA + its four branches. */
export interface RoleMatrixSectionProps {
  loading: boolean
  error: boolean
  ready: boolean
  empty: boolean
  roles: Role[]
  permissions: AdminPermissionRecord[]
  onCreateRole: () => void
  onRetry: () => void
}

/**
 * One cell of the role permission matrix (design §6.15): the access level a role
 * has for a permission category, derived from the role's granted permission ids.
 * `full` = grants a write/execute/delete action in the category; `read` = grants
 * only reads; `none` = grants nothing. The level (not colour alone) is the
 * signal — each level carries a distinct icon + title.
 */
export type PermissionMatrixLevel = "full" | "read" | "none"

/** A resolved matrix row: one permission category across every role column. */
export interface PermissionMatrixRow {
  /** The category label (e.g. "KYC", "Transactions"). */
  label: string
  /** Access level per role, index-aligned to the matrix's role columns. */
  cells: PermissionMatrixLevel[]
}

export interface RolePermissionMatrixProps {
  /** The role columns (built-in + custom). */
  roles: Role[]
  /** The permission catalog used to resolve each cell's access level. */
  permissions: AdminPermissionRecord[]
}

// ─── Roles page ──────────────────────────────────────────────────────────────────

/** Access level a role holds over a permission category (full > read > none). */
export type AccessLevel = "full" | "read" | "none"

/** The 24px access glyph tile — full (check) / read (eye) / none (x). */
export interface AccessTileProps {
  level: AccessLevel
}

/** The roles table — one row per role (name · description · count · View/Edit). */
export interface RolesTableProps {
  roles: Role[]
  onEdit: (role: Role) => void
}

/** The read-only role permission matrix — categories × role columns of access tiles. */
export interface RoleAccessMatrixProps {
  roles: Role[]
}

export interface RoleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing role, or null to create a new one. */
  role: Role | null
}

/** The editable permission matrix — category fieldsets of permission checkboxes. */
export interface PermissionMatrixEditorProps {
  /** The set of granted permission ids (canonical `permissionId(entry)`). */
  selected: Set<string>
  onToggle: (id: string) => void
  /** Built-in / in-flight → every checkbox is disabled. */
  disabled: boolean
}
