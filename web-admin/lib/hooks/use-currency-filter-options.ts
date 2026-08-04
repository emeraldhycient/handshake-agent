"use client"

import { useMemo } from "react"

import { useAdminCatalog } from "@/lib/query/hooks"
import { knownFiatCodes } from "@/lib/format"
import type { FilterOption } from "@/types"

/** The leading neutral option — an empty value omits the currency param. */
const ALL_CURRENCIES: FilterOption = { value: "", label: "All currencies" }

/**
 * Currency filter options derived from the live admin catalog read (so
 * runtime-added fiats appear and removed ones drop off) — never a hardcoded
 * list. Until the catalog resolves, falls back to the offline fiat set.
 *
 * `includeAssets` appends the crypto asset symbols (the ledger's currency axis
 * spans fiat AND crypto legs); the metrics filter is fiat-only.
 */
export function useCurrencyFilterOptions(includeAssets = false): FilterOption[] {
  const catalog = useAdminCatalog()
  return useMemo(() => {
    const fiats = catalog.data
      ? catalog.data.fiats.map((f) => f.code)
      : knownFiatCodes()
    const assets =
      includeAssets && catalog.data
        ? catalog.data.assets.map((a) => a.symbol)
        : []
    const codes = [...new Set([...fiats, ...assets])]
    return [ALL_CURRENCIES, ...codes.map((code) => ({ value: code, label: code }))]
  }, [catalog.data, includeAssets])
}
