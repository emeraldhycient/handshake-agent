import { z } from 'zod'

// One transaction row, ready for display. Amounts are already formatted display
// strings (via the server's AssetRegistry) — the FE never re-formats money.
export const TransactionHistoryItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  direction: z.enum(['in', 'out']),
  asset: z.string().optional(),
  cryptoAmount: z.string().optional(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().optional(),
  createdAt: z.string(), // ISO 8601
  receiptNumber: z.string().optional(),
})
export type TransactionHistoryItem = z.infer<typeof TransactionHistoryItemSchema>

export const TransactionWindowSchema = z.object({
  from: z.string(), // ISO 8601
  to: z.string(),
  label: z.string(), // human window description, e.g. "This month", "Jun 1 – 15, 2026"
})
export type TransactionWindow = z.infer<typeof TransactionWindowSchema>

export const TransactionHistoryResponseSchema = z.object({
  window: TransactionWindowSchema,
  items: z.array(TransactionHistoryItemSchema),
  totalCount: z.number().int().nonnegative(), // exact count in the window
  truncated: z.boolean(), // true when totalCount > items.length (row cap hit)
  downloadUrl: z.string(), // absolute, signed-token PDF download URL
})
export type TransactionHistoryResponse = z.infer<typeof TransactionHistoryResponseSchema>
