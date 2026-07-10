import { z } from 'zod'

// Read-only "show me every rate" intent (Wave K). No parameters — the calling
// layer lists every enabled, tradeable, priced pair via RatesService and replies
// with each pair's folded buy + sell figure. Moves no money (CLAUDE.md §3.1).
export const ListRatesIntentSchema = z.object({
  action: z.literal('list_rates'),
})
export type ListRatesIntent = z.infer<typeof ListRatesIntentSchema>
