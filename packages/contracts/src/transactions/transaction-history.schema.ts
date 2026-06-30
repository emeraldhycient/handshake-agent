import { z } from 'zod'
import {
  TransactionPeriodSchema,
  TransactionTypeFilterSchema,
  RelativeDurationUnitSchema,
} from '../intents/query-transactions.intent'

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
  truncated: z.boolean(), // true when totalCount > items.length (a single page)
  // Keyset pagination. `hasMore`/`nextCursor` defaulted so legacy persisted
  // `transactions` outcomes (pre-pagination) still re-parse instead of dropping
  // to a null outcome on chat-history rehydration. `txType` echoes the effective
  // filter so the card can re-query the same filter on "Show more".
  hasMore: z.boolean().default(false),
  nextCursor: z.string().nullable().default(null), // opaque keyset cursor
  txType: z.string().default('all'),
  downloadUrl: z.string(), // absolute, signed-token PDF download URL
})
export type TransactionHistoryResponse = z.infer<typeof TransactionHistoryResponseSchema>

// Query params for GET /transactions/history. `relativeAmount`/`limit` arrive as
// strings from the URL → coerce. `from`/`to` are plain strings: date-only
// (YYYY-MM-DD) for a first-page relative/explicit query, OR a full ISO timestamp
// for a frozen-window continuation (the server discriminates). A present `cursor`
// means "next keyset page of the frozen absolute window".
export const TransactionHistoryQuerySchema = z.object({
  period: TransactionPeriodSchema.optional(),
  relativeAmount: z.coerce.number().int().min(1).max(999).optional(),
  relativeUnit: RelativeDurationUnitSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  txType: TransactionTypeFilterSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type TransactionHistoryQuery = z.infer<typeof TransactionHistoryQuerySchema>
