/**
 * Centralized component prop types (`XxxProps`) for the admin app.
 * No inline component prop types — components import their props from here
 * (root §13.4). Shapes that cross the FE/BE boundary come from contracts.
 */
import type { ReactNode } from "react"
import type {
  AdminEndUserDetail,
  AdminEndUserDevice,
  AdminEndUserListItem,
  AdminUser,
  EffectiveSetting,
  KycSubmissionDetail,
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

// ─── Users page ──────────────────────────────────────────────────────────────────

export interface UserStatusBadgeProps {
  /** An end-user account status (distinct from the admin-console statuses). */
  status: AdminEndUserListItem["status"]
}

export interface KycStatusBadgeProps {
  status: AdminEndUserListItem["kycStatus"]
}

export interface UserDetailProps {
  /** The selected user's id, or null when the drawer is closed. */
  userId: string | null
  onOpenChange: (open: boolean) => void
}

export interface UserDeviceListProps {
  userId: string
  devices: AdminEndUserDevice[]
}

export interface UserActionsProps {
  /** The loaded aggregate — drives which transitions are offered. */
  user: AdminEndUserDetail
}

// ─── KYC review page ─────────────────────────────────────────────────────────────

export interface KycSubmissionProps {
  /** The selected submission's userId, or null when the drawer is closed. */
  userId: string | null
  onOpenChange: (open: boolean) => void
}

export interface KycReviewActionsProps {
  submission: KycSubmissionDetail
}
