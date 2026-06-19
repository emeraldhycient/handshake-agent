import { z } from 'zod'

export const CheckBalanceIntentSchema = z.object({
  action: z.literal('check_balance'),
})
export type CheckBalanceIntent = z.infer<typeof CheckBalanceIntentSchema>
