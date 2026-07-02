import { z } from "zod";

// Admin catalog console DTOs (Phase 6b) — READ-ONLY view of the full asset +
// fiat catalog for the Configuration group's Asset / Currency catalog screens.
//
// Why this exists alongside the public `GET /config` (PublicConfigResponse):
// `AssetRegistry.publicView()` deliberately projects ONLY *enabled* entries and
// strips every secret/infra field. The admin catalog screens must additionally
// show *disabled* (Paused / Off) listings and each entry's effective `live`
// status, so operators can see the whole catalog and its live/paused state. This
// admin view surfaces exactly the non-secret display metadata the screens render
// — symbol / display name / chain(s) / decimals / live for assets, and code /
// symbol / name / rounding (decimals) / live for currencies. It NEVER surfaces
// provider ids, master-wallet ids, AML blockchain tags, or address patterns
// (those stay server-side, per §3.4 / §7). Read-only — nothing moves money (§3.1);
// live-status edits are Phase 7.
//
// Single source of truth shared by API + web-admin.

// ── Admin catalog asset row ──────────────────────────────────────────────────
export const AdminCatalogAssetSchema = z.object({
  /** Ticker, e.g. "USDT". */
  symbol: z.string(),
  /** Human display name, e.g. "Tether USD". */
  displayName: z.string(),
  /** Asset kind — "crypto" at launch (fiat is the currencies view). */
  kind: z.string(),
  /** On-chain precision (decimal places). */
  decimals: z.number().int().nonnegative(),
  /**
   * The network display labels this asset is registered on (e.g. "TRON",
   * "Ethereum"). Resolved from the catalog network ids to their display names;
   * disabled networks are included so the operator sees the full listing.
   */
  networks: z.array(z.string()),
  /** Effective live status — the asset's `enabled` flag in the merged config. */
  live: z.boolean(),
});
export type AdminCatalogAsset = z.infer<typeof AdminCatalogAssetSchema>;

// ── Admin catalog fiat (currency) row ────────────────────────────────────────
export const AdminCatalogFiatSchema = z.object({
  /** ISO-ish code, e.g. "NGN". */
  code: z.string(),
  /** Display symbol, e.g. "₦". */
  symbol: z.string(),
  /** Human display name, e.g. "Nigerian Naira". */
  displayName: z.string(),
  /** Rounding — the currency's decimal places (dp shown on the screen). */
  decimals: z.number().int().nonnegative(),
  /** Effective live status — the fiat's `enabled` flag in the merged config. */
  live: z.boolean(),
});
export type AdminCatalogFiat = z.infer<typeof AdminCatalogFiatSchema>;

// ── GET /admin/config/catalog response ───────────────────────────────────────
/**
 * The full (enabled + disabled) asset and fiat catalog as the admin console sees
 * it. Assets feed the Asset-catalog screen; fiats feed the Currency-catalog
 * screen. No secret/infra fields are ever included.
 */
export const AdminCatalogViewSchema = z.object({
  assets: z.array(AdminCatalogAssetSchema),
  fiats: z.array(AdminCatalogFiatSchema),
});
export type AdminCatalogView = z.infer<typeof AdminCatalogViewSchema>;
