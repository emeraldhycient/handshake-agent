import { z } from 'zod'

// Relative-period enum. The model picks one of these for phrases like "today" /
// "last week"; it never computes calendar dates itself (that is the server's job).
export const TransactionPeriodSchema = z.enum([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'all',
])
export type TransactionPeriod = z.infer<typeof TransactionPeriodSchema>

// User-facing direction filter. 'receive' maps to the engine's `deposit` type
// server-side; 'all'/omitted means every money-moving type.
export const TransactionTypeFilterSchema = z.enum(['buy', 'sell', 'send', 'receive', 'all'])
export type TransactionTypeFilter = z.infer<typeof TransactionTypeFilterSchema>

// Read-only query spec emitted by the NLU layer. It is NOT a transaction: there
// is no amount, destination, or authorization — the engine is never involved.
export const QueryTransactionsIntentSchema = z.object({
  action: z.literal('query_transactions'),
  period: TransactionPeriodSchema.optional(),
  // ISO YYYY-MM-DD — emitted ONLY for an explicit calendar range stated by the user.
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  txType: TransactionTypeFilterSchema.optional(),
  // true only when the user asks for a file/statement/PDF.
  download: z.boolean().optional().default(false),
})
export type QueryTransactionsIntent = z.infer<typeof QueryTransactionsIntentSchema>
