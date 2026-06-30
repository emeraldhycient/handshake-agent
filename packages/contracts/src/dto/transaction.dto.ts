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
