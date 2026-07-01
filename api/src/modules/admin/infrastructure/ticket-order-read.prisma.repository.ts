import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ITicketOrderReadRepository,
  TicketOrderRecord,
} from '../application/ports/ticket-order-read.repository.port';

/**
 * Prisma adapter for the admin TICKET-ORDER read repository (Phase 4 wave 2).
 * Infrastructure layer only — the only place in this read path that imports
 * PrismaService (dependency-cruiser §3.2). Reads the `ticketOrder` table with a
 * (createdAt, id) keyset (newest-first) and maps Decimal → canonical string. The
 * service never sees Prisma types. Nothing here moves money (§3.1).
 */
@Injectable()
export class TicketOrderReadPrismaRepository implements ITicketOrderReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: TicketOrderRecord[]; nextCursor: string | null }> {
    // Resolve the cursor row's createdAt so the keyset compares on (createdAt, id).
    // An unknown cursor yields no anchor → return the first page.
    const cursorAnchor =
      page.cursor !== undefined
        ? await this.prisma.ticketOrder.findUnique({
            where: { id: page.cursor },
            select: { createdAt: true, id: true },
          })
        : null;

    const rows = await this.prisma.ticketOrder.findMany({
      where:
        cursorAnchor !== null
          ? {
              OR: [
                { createdAt: { lt: cursorAnchor.createdAt } },
                {
                  createdAt: cursorAnchor.createdAt,
                  id: { lt: cursorAnchor.id },
                },
              ],
            }
          : {},
      select: {
        id: true,
        userId: true,
        vendorKey: true,
        ticketType: true,
        quantity: true,
        totalAmount: true,
        paymentStatus: true,
        settlementStatus: true,
        deliveryStatus: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });

    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        vendorKey: row.vendorKey,
        ticketType: row.ticketType,
        quantity: row.quantity,
        totalAmount: row.totalAmount.toString(),
        paymentStatus: row.paymentStatus,
        settlementStatus: row.settlementStatus,
        deliveryStatus: row.deliveryStatus,
        createdAt: row.createdAt,
      })),
      nextCursor,
    };
  }
}
