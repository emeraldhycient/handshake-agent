import { Inject, Injectable } from '@nestjs/common';

import type { TicketOrderItem } from '@handshake-agent/contracts';

import {
  TICKET_ORDER_READ_REPOSITORY,
  type ITicketOrderReadRepository,
  type TicketOrderRecord,
} from './ports/ticket-order-read.repository.port';

/** Default page size for the admin ticket-orders list when the caller omits one. */
const DEFAULT_LIST_LIMIT = 20;

export interface AdminTicketListQuery {
  cursor?: string;
  limit?: number;
}

/**
 * Phase 4 (wave 2) — READ-ONLY ticket-order oversight for the admin Tickets
 * console. There is NO tickets module; this service only LISTS existing
 * TicketOrder rows. Enablement + commission are tuned via /admin/settings.
 *
 * It NEVER moves money (§3.1) and holds no Prisma import — it reaches data only
 * through the injected read-repository port (§3.2).
 */
@Injectable()
export class AdminTicketService {
  constructor(
    @Inject(TICKET_ORDER_READ_REPOSITORY)
    private readonly tickets: ITicketOrderReadRepository,
  ) {}

  async listOrders(
    query: AdminTicketListQuery,
  ): Promise<{ items: TicketOrderItem[]; nextCursor: string | null }> {
    const result = await this.tickets.list({
      cursor: query.cursor,
      limit: query.limit ?? DEFAULT_LIST_LIMIT,
    });

    return {
      items: result.items.map((t) => this.toItem(t)),
      nextCursor: result.nextCursor,
    };
  }

  private toItem(t: TicketOrderRecord): TicketOrderItem {
    return {
      id: t.id,
      userId: t.userId,
      vendorKey: t.vendorKey,
      ticketType: t.ticketType,
      quantity: t.quantity,
      totalAmount: t.totalAmount,
      paymentStatus: t.paymentStatus,
      settlementStatus: t.settlementStatus,
      deliveryStatus: t.deliveryStatus,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
