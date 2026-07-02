"use client"

/**
 * AdminSettingsPage — the signed-in operator's OWN profile + preferences
 * (design §6.16, `docs/design-ref/screens/AdminSettings.html`), wired to real data.
 *
 * Reads: the profile card (real displayName + email · role + the "2FA enrolled"
 * pill) comes from `useAdminMe()`, and an Active-sessions card lists the operator's
 * own console sessions from `useSessions()` (metadata only — device, IP, expiry;
 * the token hash is never surfaced). The Theme row stays wired to the Zustand theme
 * store.
 *
 * Phase 8: when the operator is not enrolled, the profile card offers an "Enroll 2FA"
 * button that opens the shared `MfaEnrollDialog`. The three notification-preference
 * toggles are wired to `useAdminPreferences()` / `useUpdateAdminPreferences()`: the
 * ON/OFF state is DERIVED (useMemo) from the fetched preferences layered with local
 * optimistic overrides — never seeded into state via an effect — and flipping a row
 * PATCHes the FULL preference set (the endpoint is a full-state replace). Every
 * fetched surface has four branches (loading/error/empty/data).
 */
import { useMemo, useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { MfaEnrollDialog } from "@/components/admin/mfa-enroll-dialog"
import {
  useAdminMe,
  useAdminPreferences,
  useSessions,
  useUpdateAdminPreferences,
} from "@/lib/query/hooks"
import { useThemeStore } from "@/lib/store/theme-store"
import type {
  AdminPreferences,
  AdminSessionView,
} from "@handshake-agent/contracts"
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
 * The three notification-preference rows (design markup line 8). Each `key` maps
 * to a boolean on the `AdminPreferences` DTO; the label/desc are display copy.
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

/**
 * Profile card (markup line 4) — 52px striped avatar, the real displayName, email ·
 * role, and the MFA state. The pill reflects the real `mfaEnabled`: enrolled
 * (success) or a neutral "2FA not set" so the operator sees their true posture; when
 * not enrolled it also offers an "Enroll 2FA" button that opens the MFA dialog.
 */
function ProfileCard({
  displayName,
  email,
  roleLabel,
  mfaEnabled,
  onEnroll,
}: {
  displayName: string
  email: string
  roleLabel: string
  mfaEnabled: boolean
  onEnroll: () => void
}) {
  return (
    <div className="mb-[14px] flex items-center gap-[15px] rounded-[16px] border border-line bg-card p-[18px_20px]">
      <span
        aria-hidden="true"
        style={{ background: STRIPE_AVATAR }}
        className="size-[52px] flex-none rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-extrabold text-ink">
          {displayName}
        </div>
        <div className="truncate text-[12.5px] text-ink3">
          {email} · {roleLabel}
        </div>
      </div>
      {mfaEnabled ? (
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
      ) : (
        <div className="flex flex-none items-center gap-[10px]">
          <div className="flex items-center gap-[7px] rounded-full bg-swn px-[12px] py-[6px] text-[11.5px] font-bold text-twn">
            2FA not set
          </div>
          <button
            type="button"
            onClick={onEnroll}
            className="cursor-pointer rounded-[10px] bg-brand-green px-[14px] py-2 text-[12.5px] font-bold text-white transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Enroll 2FA
          </button>
        </div>
      )}
    </div>
  )
}

/** Loading skeleton mirroring the profile card's height + shape. */
function ProfileCardSkeleton() {
  return (
    <div className="mb-[14px] flex items-center gap-[15px] rounded-[16px] border border-line bg-card p-[18px_20px]">
      <Skeleton className="size-[52px] flex-none rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-52" />
      </div>
      <Skeleton className="h-7 w-24 rounded-full" />
    </div>
  )
}

/** Inline error card for a failed profile fetch, with a retry affordance. */
function ProfileCardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mb-[14px] rounded-[16px] border border-sdn bg-sdn/40 p-[18px_20px] text-center">
      <div className="text-[13.5px] font-bold text-tdn">
        Couldn&apos;t load your profile
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Try again
      </button>
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
 * One notification-preference toggle row (markup line 8) — label/desc + the shared
 * `Switch` primitive. Controlled by the derived `checked`; flipping it fires
 * `onToggle(next)` (which PATCHes the full preference set).
 */
function PreferenceRow({
  row,
  checked,
  onToggle,
}: {
  row: AdminPreferenceRow
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[12px]">
      <div>
        <div className="text-[12.5px] font-bold text-ink">{row.label}</div>
        <div className="text-[11px] text-ink3">{row.desc}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={row.label}
      />
    </div>
  )
}

/** Card chrome shared by every branch of the preferences section (Theme row + body). */
function PreferencesCardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      <div className="mb-[6px] text-[13px] font-extrabold text-ink">
        Preferences
      </div>
      <ThemeRow />
      {children}
    </div>
  )
}

/**
 * Preferences card (markup lines 5-9) — the Theme row then the notification toggles.
 * The toggles' ON/OFF is DERIVED (useMemo) from the fetched `AdminPreferences`
 * layered with local optimistic overrides — never seeded into state via an effect.
 * Flipping a row records the override immediately (so the Switch holds) and PATCHes
 * the FULL preference set (a full-state replace). Four branches (loading/error/
 * empty(n.a.)/data).
 */
function PreferencesCard() {
  const query = useAdminPreferences()
  const update = useUpdateAdminPreferences()

  // Local optimistic overrides layered over the fetched preferences; the mutation's
  // onSuccess primes the cache so server + override agree post-write.
  const [overrides, setOverrides] = useState<Partial<AdminPreferences>>({})

  const effective = useMemo<AdminPreferences | null>(
    () => (query.data ? { ...query.data, ...overrides } : null),
    [query.data, overrides]
  )

  /** Flip one flag: hold it optimistically, then PATCH the full set. */
  function toggle(key: AdminPreferenceKey, next: boolean) {
    if (!effective) return
    const nextPrefs: AdminPreferences = { ...effective, [key]: next }
    setOverrides((prev) => ({ ...prev, [key]: next }))
    update.mutate(nextPrefs)
  }

  if (query.isLoading) {
    return (
      <PreferencesCardShell>
        <div className="flex flex-col gap-2.5 py-2" aria-busy="true">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </PreferencesCardShell>
    )
  }

  if (query.isError || !effective) {
    return (
      <PreferencesCardShell>
        <div className="py-4">
          <div className="text-[12.5px] font-bold text-tdn">
            Couldn&apos;t load your preferences
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      </PreferencesCardShell>
    )
  }

  return (
    <PreferencesCardShell>
      {PREFERENCE_ROWS.map((row) => (
        <PreferenceRow
          key={row.key}
          row={row}
          checked={effective[row.key]}
          onToggle={(next) => toggle(row.key, next)}
        />
      ))}
    </PreferencesCardShell>
  )
}

/** Human-readable expiry label for a session (falls back to the raw string). */
function expiryLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

/** One active-session row — device (UA), IP, and expiry. Metadata only. */
function SessionRow({ session }: { session: AdminSessionView }) {
  const stepUp = session.stepUpCompletedAt !== null
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[12px] last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-bold text-ink">
          {session.userAgent ?? "Unknown device"}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-ink3 tabular-nums">
          {session.ipAddress ?? "—"} · expires {expiryLabel(session.expiresAt)}
        </div>
      </div>
      {stepUp && (
        <span className="ml-3 flex-none rounded-full bg-sok px-[9px] py-[2px] text-[10.5px] font-bold text-tok">
          Stepped up
        </span>
      )}
    </div>
  )
}

/**
 * Active-sessions card — the operator's own console sessions (`useSessions`).
 * Metadata only; the token hash is never surfaced. Read-only here — revoking a
 * session is a later phase. Four branches (loading/error/empty/data).
 */
function SessionsCard() {
  const query = useSessions()
  const sessions = query.data?.items ?? []

  return (
    <div className="mt-[14px] rounded-[16px] border border-line bg-card p-[18px_20px]">
      <div className="mb-[6px] text-[13px] font-extrabold text-ink">
        Active sessions
      </div>

      {query.isLoading && (
        <div className="flex flex-col gap-2 py-1" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="py-6 text-center">
          <div className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load your sessions
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-2 text-[12.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      )}

      {query.isSuccess && sessions.length === 0 && (
        <p className="py-4 text-[12.5px] text-ink3">No active sessions.</p>
      )}

      {query.isSuccess &&
        sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
    </div>
  )
}

export function AdminSettingsPage() {
  const meQuery = useAdminMe()
  const [enrollOpen, setEnrollOpen] = useState(false)

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

      {meQuery.isLoading && <ProfileCardSkeleton />}
      {meQuery.isError && (
        <ProfileCardError onRetry={() => void meQuery.refetch()} />
      )}
      {meQuery.isSuccess && (
        <ProfileCard
          displayName={meQuery.data.displayName}
          email={meQuery.data.email}
          roleLabel={meQuery.data.role.name}
          mfaEnabled={meQuery.data.mfaEnabled}
          onEnroll={() => setEnrollOpen(true)}
        />
      )}

      <PreferencesCard />
      <SessionsCard />

      <MfaEnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} />
    </div>
  )
}
