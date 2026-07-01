/**
 * Centralized component prop types (`XxxProps`) for the admin app.
 * No inline component prop types — components import their props from here
 * (root §13.4). Shapes that cross the FE/BE boundary come from contracts.
 */
import type { ReactNode } from "react"
import type {
  AdminBeneficiary,
  AdminEndUserDetail,
  AdminEndUserDevice,
  AdminEndUserListItem,
  AdminUser,
  AmlRule,
  ComplianceReport,
  EffectiveSetting,
  KycSubmissionDetail,
  NotificationTemplate,
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
  /** The shared `grid-template-columns` utility from the settings table (§6.30). */
  gridClassName: string
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

// ─── Transactions page ───────────────────────────────────────────────────────────

export interface TransactionDetailProps {
  /** The selected transaction's id, or null when the drawer is closed. */
  transactionId: string | null
  onOpenChange: (open: boolean) => void
}

// ─── Compliance page ─────────────────────────────────────────────────────────────

export interface ComplianceEventDetailProps {
  /** The selected event's id, or null when the drawer is closed. */
  eventId: string | null
  onOpenChange: (open: boolean) => void
}

export interface AmlRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing rule, or null to create a new one. */
  rule: AmlRule | null
}

export interface ComplianceReportDraftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ComplianceReportSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The drafted report being submitted, or null when the dialog is closed. */
  report: ComplianceReport | null
}

// ─── Beneficiary oversight (in user detail) ────────────────────────────────────────

export interface BeneficiaryOverrideProps {
  /** The beneficiary whose first-use cooling-off lock can be cleared. */
  beneficiary: AdminBeneficiary
}

// ─── Notifications page (Phase 4) ──────────────────────────────────────────────────

export interface TemplateEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing template, or null to create a new one. */
  template: NotificationTemplate | null
}

// ─── Agent page (Phase 4) ──────────────────────────────────────────────────────────

export interface ConversationLogDetailProps {
  /** The selected conversation's id, or null when the drawer is closed. */
  conversationId: string | null
  onOpenChange: (open: boolean) => void
}

// ─── Metrics dashboard (Phase 5, FINAL) ──────────────────────────────────────────────

export interface MetricsBarProps {
  /** Accessible label describing what this bar represents. */
  label: string
  /** The bar's value; clamped to [0, max] for the rendered width. */
  value: number
  /** The scale maximum (the 100%-width reference). Non-positive → an empty track. */
  max: number
  /** Optional right-aligned caption (e.g. the formatted value or a percentage). */
  caption?: string
}

export interface MetricsDashboardProps {
  /**
   * When true the metrics query 403 (no Metrics grant) degrades to a friendly
   * empty state instead of an error — used on the ungated home page (§3.3 UX).
   */
  gracefulOnForbidden?: boolean
}
