"use client"

import { useMemo, useState } from "react"
import type { AdminPreferences } from "@handshake-agent/contracts"

import {
  useAdminPreferences,
  useUpdateAdminPreferences,
} from "@/lib/query/hooks"
import type { AdminPreferenceKey } from "@/types/components"

/**
 * The operator's notification-preference toggles. The ON/OFF state is DERIVED
 * (useMemo) from the fetched `AdminPreferences` layered with local optimistic
 * overrides — never seeded into state via an effect. Flipping a row records the
 * override immediately (so the Switch holds) and PATCHes the FULL preference set
 * (the endpoint is a full-state replace). Extracted so the card is presentation.
 */
export function useAdminPreferenceToggles() {
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

  return { query, effective, toggle }
}
