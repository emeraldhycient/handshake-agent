import { z } from 'zod'

export const BuyTicketIntentSchema = z.object({
  action: z.literal('buy_ticket'),
  // Free-text at this stage — the NLU layer captures the user's search phrase;
  // the engine resolves it to a concrete event and seat tier before any purchase.
  query: z.string().min(1).max(200),
})
export type BuyTicketIntent = z.infer<typeof BuyTicketIntentSchema>
