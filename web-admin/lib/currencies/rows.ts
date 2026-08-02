import type { AdminCatalogFiat } from "@handshake-agent/contracts"

import type { CurrencyCatalogRow, MakerCheckerDiffRow } from "@/types"

/**
 * Map the full admin fiat catalog (incl. disabled/off entries) onto table rows.
 * Name-enquiry availability is not modeled server-side, so it is always false (the
 * design-faithful "Unavailable"); `decimals` drives the Rounding column.
 */
export function toCatalogRows(
  fiats: readonly AdminCatalogFiat[] | undefined
): CurrencyCatalogRow[] {
  return (fiats ?? []).map((f) => ({
    id: f.code.toLowerCase(),
    code: f.code,
    symbol: f.symbol,
    name: f.displayName,
    rounding: f.decimals,
    live: f.live,
    nameEnquiry: false,
    custom: f.custom,
  }))
}

/** The one-line maker-checker diff for flipping a currency's live status. */
export function toggleDiff(
  row: CurrencyCatalogRow | null
): MakerCheckerDiffRow[] {
  if (!row) return []
  return [
    {
      field: `${row.code} · live`,
      from: row.live ? "Live" : "Off",
      to: row.live ? "Off" : "Live",
    },
  ]
}

/** Every code already in the catalog — for the add dialog's fast local dup check. */
export function existingCodesFrom(
  fiats: readonly AdminCatalogFiat[] | undefined
): string[] {
  return (fiats ?? []).map((f) => f.code)
}
