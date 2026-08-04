/**
 * Admin-settings (operator profile + preferences) constants (design §6.16). The
 * brand-green striped avatar and the three notification-preference rows.
 */
import type { AdminPreferenceRow } from "@/types"

/**
 * Striped operator avatar (§1.3 / markup line 4):
 * `repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)` — the same
 * brand-green stripe the topbar and admins table use, built from the brand token
 * so no raw hex leaks in.
 */
export const STRIPE_AVATAR =
  "repeating-linear-gradient(45deg, color-mix(in srgb, var(--brand-green) 72%, white) 0 5px, var(--brand-green) 5px 10px)"

/**
 * The three notification-preference rows (design markup line 8). Each `key` maps
 * to a boolean on the `AdminPreferences` DTO; the label/desc are display copy.
 */
export const PREFERENCE_ROWS: readonly AdminPreferenceRow[] = [
  {
    key: "emailAlerts",
    label: "Email alerts",
    desc: "Critical alerts and step-up requests to your inbox",
  },
  {
    key: "approvalMentions",
    label: "Approval mentions",
    desc: "Notify me when an action is routed to me for approval",
  },
  {
    key: "weeklyDigest",
    label: "Weekly digest",
    desc: "A Monday summary of queue depth and open breaks",
  },
]
