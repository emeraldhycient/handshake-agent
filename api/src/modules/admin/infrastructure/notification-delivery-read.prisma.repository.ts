/**
 * Prisma adapter for INotificationDeliveryReadRepository (admin Comms delivery-log,
 * Phase 6b).
 *
 * READ-ONLY delivery-log signals for the operator Comms console. Infrastructure
 * layer only — imports the generated Prisma client / PrismaService
 * (dependency-cruiser rule §3.2). Maps Prisma rows → application-layer records; the
 * service never sees Prisma types. Nothing here mutates anything (§3.1).
 *
 * ROW STATUS (how it is derived):
 *   Each `Notification` carries authoritative top-level flags (`isSent`,
 *   `isFailed`) plus a per-attempt `deliveryLog` JSON array
 *   (`[{ channel, status, deliveredAt, ... }]`). We derive the row's terminal
 *   state from those, never fabricating one:
 *     isFailed  → `bounced` if any attempt bounced, else `failed`
 *     isSent    → `delivered` if any attempt confirmed delivery, else `sent`
 *     otherwise → `sending` (still in flight)
 *
 * BOUNCE/COMPLAINT STATS (how they are derived):
 *   Counted from the authoritative `ChannelOutboundDispatch` rows (the dispatch
 *   state machine): `bounced` status → a bounce. There is no complaint/spam signal
 *   in the model, so `complaintCount` is always 0 — we never fabricate one; the
 *   contract documents the field as 0 when the provider surfaces none.
 */

import { Injectable } from '@nestjs/common';

import { DispatchStatus } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  DeliveryLogRowRecord,
  DeliveryRowStatus,
  DeliveryStatsRecord,
  INotificationDeliveryReadRepository,
} from '../application/ports/notification-delivery-read.repository.port';

@Injectable()
export class NotificationDeliveryReadPrismaRepository implements INotificationDeliveryReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recentDeliveries(limit: number): Promise<DeliveryLogRowRecord[]> {
    const rows = await this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        primaryChannel: true,
        templateKey: true,
        eventType: true,
        deliveryLog: true,
        isSent: true,
        isFailed: true,
        createdAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      channel: String(row.primaryChannel),
      templateKey: row.templateKey,
      eventType: String(row.eventType),
      createdAt: row.createdAt,
      status: deriveStatus(row.isSent, row.isFailed, row.deliveryLog),
    }));
  }

  async deliveryStats(sampleWindow: number): Promise<DeliveryStatsRecord> {
    // Sample the most recent dispatch attempts (newest first), then count the
    // terminal bounce state within that window. Complaint has no model signal.
    const attempts = await this.prisma.channelOutboundDispatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: sampleWindow,
      select: { status: true },
    });

    const bouncedCount = attempts.filter(
      (a) => a.status === DispatchStatus.bounced,
    ).length;

    return {
      bouncedCount,
      complaintCount: 0,
      totalDispatches: attempts.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure derivation (no Prisma import needed at call site)
// ---------------------------------------------------------------------------

/** One entry of the `deliveryLog` JSON array (all fields optional/defensive). */
interface DeliveryLogAttempt {
  status?: unknown;
  deliveredAt?: unknown;
}

/**
 * Derive the row's terminal delivery state from the authoritative top-level flags,
 * refined by the per-attempt delivery log when it carries a delivered/bounce signal.
 */
function deriveStatus(
  isSent: boolean,
  isFailed: boolean,
  deliveryLog: unknown,
): DeliveryRowStatus {
  const attempts = asAttempts(deliveryLog);

  if (isFailed) {
    return attempts.some((a) => a.status === 'bounced') ? 'bounced' : 'failed';
  }
  if (isSent) {
    const delivered = attempts.some(
      (a) => a.status === 'delivered' || a.deliveredAt != null,
    );
    return delivered ? 'delivered' : 'sent';
  }
  return 'sending';
}

/** Coerce the `deliveryLog` JSON column (unknown) to a defensive attempt array. */
function asAttempts(value: unknown): DeliveryLogAttempt[] {
  return Array.isArray(value) ? (value as DeliveryLogAttempt[]) : [];
}
