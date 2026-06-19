import { z } from 'zod'

export const BuyTicketIntentSchema = z.object({
  action: z.literal('buy_ticket'),
  query: z.string().min(1).max(200),
})
export type BuyTicketIntent = z.infer<typeof BuyTicketIntentSchema>
