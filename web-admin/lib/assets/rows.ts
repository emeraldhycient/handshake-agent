import type { AdminCatalogView } from "@handshake-agent/contracts"

import type { AssetCatalogRow } from "@/types"

/**
 * Map a real catalog asset onto the design's row shape. Min/max + contract are not
 * surfaced by the catalog read (per-asset limits aren't modeled), so they render "—"
 * (design-faithful).
 */
export function toAssetRow(
  asset: AdminCatalogView["assets"][number]
): AssetCatalogRow {
  return {
    sym: asset.symbol,
    name: asset.displayName,
    chain: asset.networks.join(" · ") || "—",
    dec: asset.decimals,
    minmax: "—",
    contract: "—",
    logo: asset.logoUrl,
    live: asset.live,
  }
}

/** Stable identity for an asset row (ticker + chain uniquely name a listing). */
export function assetKey(asset: AssetCatalogRow): string {
  return `${asset.sym}-${asset.chain}`
}

/** The registry key backing an asset's live status (`catalog.assets.<sym>.enabled`). */
export function assetEnabledKey(asset: AssetCatalogRow): string {
  return `catalog.assets.${asset.sym}.enabled`
}
