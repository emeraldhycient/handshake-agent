import { z } from "zod";

export const PublicFiatSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  /**
   * ISO 3166-1 alpha-2 country whose banking rails settle this currency
   * (e.g. NGN → 'NG'). Populated server-side from `CatalogFiat.country` /
   * `AssetRegistry.countryForFiat`. Optional: a runtime-added custom fiat
   * without a country mapping is still surfaced (the field is simply omitted).
   * The web add-bank form derives its country from this instead of hardcoding
   * a currency→country map (single source of truth, root CLAUDE.md §7/§8).
   */
  country: z.string().length(2).optional(),
});

export const PublicAssetSchema = z.object({
  symbol: z.string(),
  displayName: z.string(),
  decimals: z.number().int().nonnegative(),
  networks: z.array(z.string()),
});

export const PublicNetworkSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

export const PublicConfigResponseSchema = z.object({
  fiats: z.array(PublicFiatSchema),
  assets: z.array(PublicAssetSchema),
  networks: z.array(PublicNetworkSchema),
  capabilities: z.record(z.boolean()),
});

export type PublicConfigResponse = z.infer<typeof PublicConfigResponseSchema>;
