import { z } from 'zod'
import { SupportedAssetSchema } from '../common'

// `asset` is optional: when the user asks about one asset ("my USDT balance") the
// model fills it; when they ask for everything ("show my assets") it is omitted and
// the read service returns every supported asset's balance.
export const CheckBalanceIntentSchema = z.object({
  action: z.literal('check_balance'),
  asset: SupportedAssetSchema.optional(),
})
export type CheckBalanceIntent = z.infer<typeof CheckBalanceIntentSchema>
