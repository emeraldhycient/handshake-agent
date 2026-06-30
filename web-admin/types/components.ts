/**
 * Centralized component prop types (`XxxProps`) for the admin app.
 * No inline component prop types — components import their props from here
 * (root §13.4). Shapes that cross the FE/BE boundary come from contracts.
 */
import type { ReactNode } from "react"
import type {
  AdminUser,
  EffectiveSetting,
  Role,
} from "@handshake-agent/contracts"

// ─── Shell + gating ──────────────────────────────────────────────────────────────

export interface RequireAuthProps {
  children: ReactNode
}

export interface RequirePermissionProps {
  /** The `web_page` resourceId that must be present in `adminMe.pages`. */
  page: string
  children: ReactNode
}

export interface AppShellProps {
  children: ReactNode
}

export interface LoginFormProps {
  className?: string
}

// ─── Step-up flow ────────────────────────────────────────────────────────────────

export interface StepUpDialogProps {
  open: boolean
  /** Whether the signed-in admin has MFA enabled (drives password vs TOTP). */
  mfaEnabled: boolean
  /** Called after a successful step-up — the caller retries its mutation. */
  onSuccess: () => void
  onOpenChange: (open: boolean) => void
}

export interface MfaEnrollDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Admins page ─────────────────────────────────────────────────────────────────

export interface InviteAdminDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: Role[]
}

export interface AdminRowActionsProps {
  admin: AdminUser
  roles: Role[]
}

// ─── Roles page ──────────────────────────────────────────────────────────────────

export interface RoleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing role, or null to create a new one. */
  role: Role | null
}

// ─── Settings page ───────────────────────────────────────────────────────────────

export interface SettingFieldProps {
  /** The effective config leaf to render + (when editable) save. */
  setting: EffectiveSetting
}
