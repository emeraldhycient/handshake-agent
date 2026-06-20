import { z } from "zod"
import { AssetViewSchema } from "./chat"

// WalletAsset extends the shared AssetView base (sym, name, amount, value, tint)
// with the dashboard-specific sub-label and change-percentage fields.
export const WalletAssetSchema = AssetViewSchema.extend({
  /** Sub-label e.g. network name "TRC-20", "ERC-20", "Native" */
  sub: z.string(),
  /** Percentage change string e.g. "+0.01%" */
  change: z.string(),
})

export type WalletAsset = z.infer<typeof WalletAssetSchema>
