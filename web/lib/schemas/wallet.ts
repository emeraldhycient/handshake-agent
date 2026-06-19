import { z } from "zod"

export const WalletAssetSchema = z.object({
  sym: z.string(),
  name: z.string(),
  /** Sub-label e.g. network name "TRC-20", "ERC-20", "Native" */
  sub: z.string(),
  amount: z.string(),
  value: z.string(),
  /** Percentage change string e.g. "+0.01%" */
  change: z.string(),
  /** Hex colour tint for the asset icon */
  tint: z.string(),
})

export type WalletAsset = z.infer<typeof WalletAssetSchema>
