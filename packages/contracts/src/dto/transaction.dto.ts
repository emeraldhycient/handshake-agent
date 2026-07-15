import { z } from "zod";

export const TransactionListItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  asset: z.string().optional(),
  cryptoAmount: z.string().optional(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().optional(),
  counterparty: z.string().optional(),
  // Per-viewer flow direction. Snapshotted onto the Transaction metadata at
  // settle (internal transfers carry a sender row `out` + a recipient row `in`);
  // the serving projection falls back to a type heuristic when it is absent.
  direction: z.enum(["in", "out"]).optional(),
  createdAt: z.string(),
});
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>;

export const TransactionListResponseSchema = z.object({
  items: z.array(TransactionListItemSchema),
  nextCursor: z.string().optional(),
});
export type TransactionListResponse = z.infer<
  typeof TransactionListResponseSchema
>;
