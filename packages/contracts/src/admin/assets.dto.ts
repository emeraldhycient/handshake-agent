import { z } from "zod";

/**
 * Admin asset-catalog discovery DTOs (root CLAUDE.md §7 — the capability/service
 * registry). Two admin routes on `/admin/config/assets` surface the Blockradar-driven
 * asset discovery that already runs at boot (CatalogSyncService) so an operator can
 * re-sync on demand and review what the provider found:
 *
 *   GET  /admin/config/assets/discovered — the provider-discovered asset overlay
 *   POST /admin/config/assets/sync       — re-run discovery against the live wallet
 *
 * Neither moves money (§3.1): discovery is a read of the provider's asset listing.
 * The sync is step-up-gated + audited server-side (it can bring new assets into the
 * tradeable overlay). Shapes cross the FE/BE boundary, so they live here (§8).
 */

/**
 * One provider-discovered asset, projected for the admin review screen. `inStaticCatalog`
 * distinguishes an asset already managed in the static catalog from a genuinely-new one.
 */
export const AdminDiscoveredAssetSchema = z.object({
  symbol: z.string(),
  displayName: z.string(),
  decimals: z.number().int(),
  networks: z.array(z.string()),
  /** On-chain contract address; null for a native asset. */
  contractAddress: z.string().nullable(),
  /** Blockradar's asset UUID (used in balance/withdraw calls); null if not resolved. */
  blockradarAssetId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  enabled: z.boolean(),
  inStaticCatalog: z.boolean(),
});
export type AdminDiscoveredAsset = z.infer<typeof AdminDiscoveredAssetSchema>;

export const AdminDiscoveredAssetListResponseSchema = z.object({
  items: z.array(AdminDiscoveredAssetSchema),
});
export type AdminDiscoveredAssetListResponse = z.infer<
  typeof AdminDiscoveredAssetListResponseSchema
>;

/** POST /admin/config/assets/sync response — what the re-sync found. */
export const AdminAssetsSyncResponseSchema = z.object({
  /** Total assets seen across all enabled networks during the sync. */
  discoveredCount: z.number().int(),
  /** Of those, how many are NOT already in the static catalog (genuinely new). */
  newCount: z.number().int(),
});
export type AdminAssetsSyncResponse = z.infer<
  typeof AdminAssetsSyncResponseSchema
>;
