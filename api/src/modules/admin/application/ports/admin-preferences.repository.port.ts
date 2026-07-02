// Port for the self-scoped admin notification-preferences store (ADM Phase 8).
// Each admin owns exactly one `admin_preferences` row keyed by their adminId. The
// application layer reaches it only through this port (§3.2) — no Prisma import.
// `get` returns null when the admin has never persisted a preference; the service
// falls back to the all-true default so a fresh admin sees every toggle on.

export const ADMIN_PREFERENCES_REPOSITORY = Symbol(
  'ADMIN_PREFERENCES_REPOSITORY',
);

/** The three self-scoped notification toggles persisted per admin. */
export interface AdminPreferencesRecord {
  emailAlerts: boolean;
  approvalMentions: boolean;
  weeklyDigest: boolean;
}

export interface IAdminPreferencesRepository {
  /** The admin's persisted preferences, or null if no row exists yet. */
  get(adminId: string): Promise<AdminPreferencesRecord | null>;
  /**
   * Create or replace the admin's preference row (full-state replace). Returns the
   * persisted state. Upsert keyed on adminId so a first-time PATCH creates the row.
   */
  upsert(
    adminId: string,
    prefs: AdminPreferencesRecord,
  ): Promise<AdminPreferencesRecord>;
}
