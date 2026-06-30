/**
 * DI token + port for the admin TICKET-ORDER read repository (Phase 4 wave 2).
 *
 * There is NO tickets module yet — the admin console owns this READ-ONLY surface.
 * It projects existing `TicketOrder` rows (Prisma `10-tickets.prisma`); enablement
 * + commission are tuned via /admin/settings. Nothing here moves money (§3.1).
 *
 * The concrete Prisma adapter lives in `admin/infrastructure`; application/domain
 * depend only on this abstraction (clean-arch §4.1, CLAUDE.md §3.2). Decimal columns
 * are projected as canonical strings (never Prisma Decimal); dates stay as `Date`.
 */
export const TICKET_ORDER_READ_REPOSITORY = Symbol(
  'TICKET_ORDER_READ_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Record type (application-layer projection — never a Prisma type)
// ---------------------------------------------------------------------------

/** A ticket-order summary row for the admin list. */
export interface TicketOrderRecord {
  id: string;
  userId: string;
  vendorKey: string;
  ticketType: string;
  quantity: number;
  /** Canonical decimal string (NGN) — never a JS float. */
  totalAmount: string;
  paymentStatus: string;
  settlementStatus: string;
  deliveryStatus: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ITicketOrderReadRepository {
  /**
   * Lists ticket orders newest-first via a (createdAt, id) keyset. Fetches
   * `limit + 1` rows internally to compute `nextCursor`. Returns an empty list
   * when there are no orders.
   */
  list(page: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: TicketOrderRecord[]; nextCursor: string | null }>;
}
