"use client"

import type { ReactNode } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { PREFERENCE_ROWS } from "@/constants/admin-settings"
import { useAdminPreferenceToggles } from "@/lib/hooks/use-admin-preference-toggles"

import { PreferenceRow } from "./preference-row"
import { ThemeRow } from "./theme-row"

/** Card chrome shared by every branch of the preferences section (Theme row + body). */
function PreferencesCardShell({ children }: { children: ReactNode }) {
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
 * The toggles' ON/OFF is derived from the fetched `AdminPreferences` layered with
 * local optimistic overrides (see `useAdminPreferenceToggles`). Four branches
 * (loading / error / empty(n.a.) / data).
 */
export function PreferencesCard() {
  const { query, effective, toggle } = useAdminPreferenceToggles()

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
