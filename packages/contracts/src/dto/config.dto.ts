import { z } from "zod";

export const PublicFiatSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
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
