/** The operator's own settings + my-account pages. */

// ─── Admin settings page (design §6.16) ────────────────────────────────────────────
// The signed-in operator's OWN profile + preferences. Profile + 2FA come from
// `useAdminMe`; the Theme row is wired to the theme store; the notification
// toggles read/write `useAdminPreferences` / `useUpdateAdminPreferences` (a
// full-state PATCH). This key is the shared boolean field on the `AdminPreferences` DTO.

/** A notification-preference toggle key — a boolean field on `AdminPreferences`. */
export type AdminPreferenceKey =
  | "emailAlerts"
  | "approvalMentions"
  | "weeklyDigest"

/** One rendered preference-toggle row (label + description; value is derived). */
export interface AdminPreferenceRow {
  key: AdminPreferenceKey
  /** The row title (e.g. "Email alerts"). */
  label: string
  /** The one-line explanation under the title. */
  desc: string
}

/** The profile card — striped avatar, identity, and the 2FA posture + enroll CTA. */
export interface ProfileCardProps {
  displayName: string
  email: string
  roleLabel: string
  mfaEnabled: boolean
  onEnroll: () => void
}

/** One notification-preference toggle row (derived `checked`; flip → full-set PATCH). */
export interface PreferenceRowProps {
  row: AdminPreferenceRow
  checked: boolean
  onToggle: (next: boolean) => void
}

/** One active-session row — device (UA), IP, expiry, and the stepped-up pill. */
export interface SessionRowProps {
  session: import("@handshake-agent/contracts").AdminSessionView
}

// ─── My account page (self-service profile, /account) ───────────────────────────────

/** The self-service profile form — edits the operator's own display name (PATCH /admin/me). */
export interface AccountFormProps {
  me: import("@handshake-agent/contracts").AdminMe
}

/** One read-only identity row (email / role / status / 2FA — managed by an admin). */
export interface ReadOnlyRowProps {
  label: string
  value: string
  capitalize?: boolean
}
