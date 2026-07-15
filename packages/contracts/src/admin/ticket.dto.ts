import { z } from "zod";

// Admin Tickets oversight DTOs (Phase 4 wave 2) — READ-ONLY projection of the
// `TicketOrder` rows (Prisma `10-tickets.prisma`). There is NO tickets module yet;
// the admin console only LISTS existing orders. Decimal columns are projected as
// canonical strings (never floats). Single source of truth shared by API + web-admin.
// Nothing here moves money (§3.1) — these shapes only project existing rows.

export const TicketOrderItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  vendorKey: z.string(),
  ticketType: z.string(),
  quantity: z.number(),
  /** Canonical decimal string — never a JS float. Denominated in `currency`. */
  totalAmount: z.string(),
  /** ISO fiat code `totalAmount` is denominated in — never assume NGN. */
  currency: z.string(),
  paymentStatus: z.string(),
  settlementStatus: z.string(),
  deliveryStatus: z.string(),
  createdAt: z.string(),
});
export type TicketOrderItem = z.infer<typeof TicketOrderItemSchema>;

export const TicketOrderListResponseSchema = z.object({
  items: z.array(TicketOrderItemSchema),
  nextCursor: z.string().nullable(),
});
export type TicketOrderListResponse = z.infer<
  typeof TicketOrderListResponseSchema
>;
