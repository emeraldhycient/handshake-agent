import { z } from 'zod'

// Asset-agnostic by design — the engine returns all balances in one call so
// the user always sees the complete picture, regardless of which asset they asked about.
export const CheckBalanceIntentSchema = z.object({
  action: z.literal('check_balance'),
})
export type CheckBalanceIntent = z.infer<typeof CheckBalanceIntentSchema>
