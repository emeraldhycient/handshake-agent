"use client"

import { useEffect, useMemo, useState } from "react"

import { pushToast } from "@/lib/store/toast-store"
import { downloadFile, exportFilename } from "@/lib/download"
import { exportEndUsers } from "@/lib/api/users"
import { useEndUsers } from "@/lib/query/hooks"
import {
  KYC_BUCKET_TO_STATUS,
  PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
} from "@/constants/users"
import { toRow } from "@/lib/users/format"
import type {
  AdminEndUserSearchQuery,
  KycTier,
} from "@handshake-agent/contracts"
import type { UserKycStatus, UserRiskFlag } from "@/types/components"

/**
 * The Users-directory view-model: search/filter/selection/keyset-cursor state, the
 * `useEndUsers` query, and every handler the page composes. Kept routing-free (the
 * page owns row navigation) so this stays pure state/data and independently testable.
 */
export function useUsersDirectory() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [kyc, setKyc] = useState("all")
  const [tier, setTier] = useState("all")
  const [country, setCountry] = useState("all")
  const [risk, setRisk] = useState<UserRiskFlag | "">("")
  const [selected, setSelected] = useState<readonly string[]>([])
  const [exporting, setExporting] = useState(false)
  // Cursor stack for keyset pagination: [null, cursorForPage2, …]. The last entry
  // is the cursor that fetched the current page (null = first page).
  const [cursorStack, setCursorStack] = useState<readonly (string | null)[]>([
    null,
  ])

  // Debounce the free-text search before it hits the server-side `query` param (§7).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  // Reset to the first page whenever a filter changes (a new keyset window).
  function resetPaging() {
    setCursorStack([null])
  }

  const cursor = cursorStack[cursorStack.length - 1]
  const queryArg: AdminEndUserSearchQuery = useMemo(
    () => ({
      ...(debouncedSearch ? { query: debouncedSearch } : {}),
      ...(kyc !== "all"
        ? { kycStatus: KYC_BUCKET_TO_STATUS[kyc as UserKycStatus] }
        : {}),
      ...(tier !== "all" ? { kycTier: tier as KycTier } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, kyc, tier, cursor]
  )

  const { data, isLoading, isError, isSuccess, refetch, isFetching } =
    useEndUsers(queryArg)

  // Search / KYC-status / tier filter SERVER-side; the risk chips (simSwap +
  // sanctions on the row) and country (not in the contract) narrow client-side.
  const rows = useMemo(() => {
    return (data?.items ?? []).map(toRow).filter((u) => {
      if (country !== "all") return false // country is a shape gap — matches nothing
      if (risk === "simSwap" && !u.simSwapFlagged) return false
      if (risk === "sanctions" && !u.sanctionsFlagged) return false
      if (risk === "velocity") return false // not modeled on the list item
      return true
    })
  }, [data, country, risk])

  const canPrev = cursorStack.length > 1
  const canNext = Boolean(data?.nextCursor)
  const allSelected = selected.length >= rows.length && rows.length > 0

  function onFilterChange<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      resetPaging()
    }
  }

  function toggleRisk(value: UserRiskFlag) {
    setRisk((prev) => (prev === value ? "" : value))
    resetPaging()
  }

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.length >= rows.length ? [] : rows.map((u) => u.id)
    )
  }

  function clearSelection() {
    setSelected([])
  }

  function goNext() {
    if (!data?.nextCursor) return
    clearSelection()
    setCursorStack((prev) => [...prev, data.nextCursor])
  }

  function goPrev() {
    clearSelection()
    setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }

  /**
   * Download a PII-minimised CSV (last-4 only, §3.4) of the users matching the
   * current filters — or just the selected rows when there's a selection.
   */
  async function onExport() {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await exportEndUsers(
        queryArg,
        selected.length > 0 ? [...selected] : undefined
      )
      downloadFile(blob, exportFilename("users"))
    } catch {
      pushToast("Couldn't export users. Try again.", "warn")
    } finally {
      setExporting(false)
    }
  }

  return {
    // query state
    rows,
    total: data?.total,
    isLoading,
    isError,
    isSuccess,
    isFetching,
    refetch,
    // filters
    search,
    kyc,
    tier,
    country,
    risk,
    onSearchChange: onFilterChange(setSearch),
    onKycChange: onFilterChange(setKyc),
    onTierChange: onFilterChange(setTier),
    onCountryChange: onFilterChange(setCountry),
    toggleRisk,
    // selection
    selected,
    allSelected,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    // pagination
    pageIndex: cursorStack.length,
    canPrev,
    canNext,
    goNext,
    goPrev,
    // export
    exporting,
    onExport,
  }
}
