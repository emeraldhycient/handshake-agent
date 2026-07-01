"use client"

/**
 * AdminSettingsPage — the signed-in operator's OWN profile + preferences
 * (design §6.16). Pixel-for-pixel reproduction of
 * `docs/design-ref/screens/AdminSettings.html`: a profile card (52px striped
 * avatar, name, email · role, "2FA enrolled" pill) followed by a Preferences
 * card whose first row is the Theme toggle and whose remaining rows are the
 * design's `prefRows` notification-preference toggles.
 *
 * DESIGN REPRODUCTION ONLY — no real API data. The profile identity is the
 * design's own seed content (`admins[0]` = "Amara Okeke", amara@handshake.ng,
 * Super Admin, tfa:true → "2FA enrolled"; logic.js lines 132 / 168 / 411-412).
 * Real-data reintegration (the old `useAdminMe` wiring) is a separate later step.
 *
 * The only live behaviour is the design's own:
 * - the Theme row is wired to the Zustand theme store (`toggleTheme`, mirrored to
 *   the DOM by `components/theme-provider.tsx`), matching the markup's
 *   `onClick="{{ toggleTheme }}"` + `{{ themeName }}` label; and
 * - the `prefRows` toggles hold design-faithful local UI state (no endpoint yet),
 *   matching the markup's `p.track` / `p.knob` soft toggle.
 */
import { useState } from "react"

import { useThemeStore } from "@/lib/store/theme-store"
import type { AdminPreferenceKey, AdminPreferenceRow } from "@/types/components"

/**
 * Striped operator avatar (§1.3 / markup line 4):
 * `repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)` — the same
 * brand-green stripe the topbar and admins table use, built from the brand token
 * so no raw hex leaks in.
 */
const STRIPE_AVATAR =
  "repeating-linear-gradient(45deg, color-mix(in srgb, var(--brand-green) 72%, white) 0 5px, var(--brand-green) 5px 10px)"

/**
 * The design's own operator identity (logic.js `admins[0]`, line 132) surfaced by
 * `adminName` / `roleLabel` (lines 411-412). Reproduced verbatim so the screen
 * shows exactly what the design shows.
 */
const OPERATOR = {
  name: "Amara Okeke",
  email: "amara@handshake.ng",
  roleLabel: "Super Admin",
} as const

/**
 * The design's `prefRows` (markup line 8, `hint-placeholder-count="3"`). The
 * markup truncates the row content, so these reproduce the three representative
 * comms-preference rows faithfully with their default toggle values.
 */
const PREFERENCE_ROWS: readonly AdminPreferenceRow[] = [
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

/** The default `prefRows` toggle values shown in the design. */
const DEFAULT_PREFS: Record<AdminPreferenceKey, boolean> = {
  emailAlerts: true,
  approvalMentions: true,
  weeklyDigest: false,
}

/**
 * Profile card (markup line 4) — 52px striped avatar, name, email · role, and the
 * "2FA enrolled" success pill (the markup hardcodes the enrolled state).
 */
function ProfileCard() {
  return (
    <div className="mb-[14px] flex items-center gap-[15px] rounded-[16px] border border-line bg-card p-[18px_20px]">
      <span
        aria-hidden="true"
        style={{ background: STRIPE_AVATAR }}
        className="size-[52px] flex-none rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-extrabold text-ink">
          {OPERATOR.name}
        </div>
        <div className="truncate text-[12.5px] text-ink3">
          {OPERATOR.email} · {OPERATOR.roleLabel}
        </div>
      </div>
      <div className="flex items-center gap-[7px] rounded-full bg-sok px-[12px] py-[6px] text-[11.5px] font-bold text-tok">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 11V8a5 5 0 0 1 10 0v3"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <rect
            x="5"
            y="11"
            width="14"
            height="9"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.7"
          />
        </svg>
        2FA enrolled
      </div>
    </div>
  )
}

/**
 * The Theme row (markup line 7) — label + description on the left, a click-to-flip
 * button showing `{{ themeName }}`. Wired to the theme store's `toggleTheme`.
 */
function ThemeRow() {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const themeName = theme === "light" ? "Light" : "Dark"
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[12px]">
      <div>
        <div className="text-[12.5px] font-bold text-ink">Theme</div>
        <div className="text-[11px] text-ink3">Light / dark appearance</div>
      </div>
      <button
        type="button"
        onClick={() => toggleTheme()}
        aria-label={
          theme === "light" ? "Switch to dark theme" : "Switch to light theme"
        }
        className="flex items-center gap-[7px] rounded-[10px] border border-line px-[14px] py-2 text-[12.5px] font-bold text-ink transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {themeName}
      </button>
    </div>
  )
}

/**
 * One `prefRows` toggle row (markup line 8) — label/desc + the design's soft
 * toggle: a 46×26 track whose `background` = `p.track` and whose 20px knob sits at
 * `left = p.knob`, transitioning on `left`.
 */
function PreferenceRow({
  row,
  checked,
  onToggle,
}: {
  row: AdminPreferenceRow
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[12px]">
      <div>
        <div className="text-[12.5px] font-bold text-ink">{row.label}</div>
        <div className="text-[11px] text-ink3">{row.desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={row.label}
        onClick={onToggle}
        style={{
          background: checked ? "var(--brand-green)" : "var(--card2)",
        }}
        className="relative h-[26px] w-[46px] cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span
          className="absolute top-[3px] size-[20px] rounded-full bg-white transition-[left] duration-150"
          style={{ left: checked ? "23px" : "3px" }}
        />
      </button>
    </div>
  )
}

/** Preferences card (markup lines 5-9) — the Theme row then the `prefRows`. */
function PreferencesCard() {
  const [prefs, setPrefs] =
    useState<Record<AdminPreferenceKey, boolean>>(DEFAULT_PREFS)
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      <div className="mb-[6px] text-[13px] font-extrabold text-ink">
        Preferences
      </div>
      <ThemeRow />
      {PREFERENCE_ROWS.map((row) => (
        <PreferenceRow
          key={row.key}
          row={row}
          checked={prefs[row.key]}
          onToggle={() =>
            setPrefs((prev) => ({ ...prev, [row.key]: !prev[row.key] }))
          }
        />
      ))}
    </div>
  )
}

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

      <ProfileCard />
      <PreferencesCard />
    </div>
  )
}
