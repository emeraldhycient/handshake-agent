import { z } from "zod";

// Admin notification-preference DTOs (Phase 8) — the self-scoped notification
// toggles an admin sets from the settings page (`AdminPreferences` model).
// GET returns the current state; PATCH is a FULL-STATE replace (the settings
// UI is a set of independent toggles that always submit all three flags). The
// endpoint is self-scoped, write-gated, and audited server-side. Single source
// of truth shared by the API and web-admin.

export const AdminPreferencesSchema = z.object({
  // Send operational email alerts to this admin.
  emailAlerts: z.boolean(),
  // Notify this admin when they are mentioned on an approval / change request.
  approvalMentions: z.boolean(),
  // Send this admin the weekly operations digest.
  weeklyDigest: z.boolean(),
});
export type AdminPreferences = z.infer<typeof AdminPreferencesSchema>;

// Update request — the same three booleans (full-state replace; matches the
// toggle UI which always submits the complete preference set).
export const AdminPreferencesUpdateRequestSchema = z.object({
  emailAlerts: z.boolean(),
  approvalMentions: z.boolean(),
  weeklyDigest: z.boolean(),
});
export type AdminPreferencesUpdateRequest = z.infer<
  typeof AdminPreferencesUpdateRequestSchema
>;
