"use client"

/**
 * AdminSettingsPage — the signed-in operator's OWN profile + preferences
 * (design §6.16). Composition only: each card is a self-contained section under
 * `components/admin/admin-settings/*` that owns its own read + four branches —
 *   • ProfileSection: `useAdminMe` + the enroll-2FA dialog
 *   • PreferencesCard: theme row + notification toggles (`useAdminPreferenceToggles`)
 *   • SessionsCard: the operator's own console sessions (`useSessions`)
 * Preferences are a full-state PATCH; nothing here moves money.
 */
import { ProfileSection } from "@/components/admin/admin-settings/profile-section"
import { PreferencesCard } from "@/components/admin/admin-settings/preferences-card"
import { SessionsCard } from "@/components/admin/admin-settings/sessions-card"

export function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-[820px] p-[26px_30px_60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Admin settings
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Your profile, 2FA, notification preferences and theme.
        </p>
      </div>

      <ProfileSection />
      <PreferencesCard />
      <SessionsCard />
    </div>
  )
}
