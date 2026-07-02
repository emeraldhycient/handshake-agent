import { Inject, Injectable } from '@nestjs/common';

import {
  NotificationChannelSchema,
  type DeliveryLogEntry,
  type DeliveryLogResponse,
} from '@handshake-agent/contracts';

import {
  NOTIFICATION_DELIVERY_READ_REPOSITORY,
  type DeliveryLogRowRecord,
  type INotificationDeliveryReadRepository,
} from './ports/notification-delivery-read.repository.port';

/** How many recent notifications the delivery log surfaces. */
const DELIVERY_LOG_LIMIT = 50;

/** How many recent dispatch attempts the bounce/complaint rates sample over. */
const STATS_SAMPLE_WINDOW = 1000;

/**
 * Phase 6b (Comms READ enrichment) — the admin READ-ONLY notification delivery
 * log: recent issued notifications (channel / template / event / issue-time /
 * derived status) plus aggregate bounce/complaint rates from the per-attempt
 * dispatch rows.
 *
 * NEVER moves money (§3.1) and holds no Prisma import — it reaches data
 * exclusively through the injected NOTIFICATION_DELIVERY_READ_REPOSITORY port
 * (§3.2). It serializes the row `Date` to an ISO string, derives the rates from
 * the raw counts (guarding a zero denominator), and drops any channel outside the
 * contract's delivery-channel set (`web` is an agent surface, not a delivery
 * channel — ADR-0004).
 */
@Injectable()
export class AdminNotificationDeliveryService {
  constructor(
    @Inject(NOTIFICATION_DELIVERY_READ_REPOSITORY)
    private readonly repo: INotificationDeliveryReadRepository,
  ) {}

  /** The composite delivery-log payload — recent rows + aggregate stats. */
  async deliveryLog(): Promise<DeliveryLogResponse> {
    const [rows, stats] = await Promise.all([
      this.repo.recentDeliveries(DELIVERY_LOG_LIMIT),
      this.repo.deliveryStats(STATS_SAMPLE_WINDOW),
    ]);

    const items = rows
      .map(toEntry)
      .filter((entry): entry is DeliveryLogEntry => entry !== null);

    const { totalDispatches } = stats;
    const rate = (count: number): number =>
      totalDispatches === 0 ? 0 : count / totalDispatches;

    return {
      items,
      stats: {
        bounceRate: rate(stats.bouncedCount),
        complaintRate: rate(stats.complaintCount),
        sampleSize: totalDispatches,
      },
    };
  }
}

/**
 * Map a repository row to a delivery-log entry, or null when the channel is
 * outside the contract's delivery-channel set (e.g. `web`). Keeping the guard here
 * (a `safeParse` on the channel) means the response never carries an unmodelled
 * channel that the boundary schema would later reject.
 */
function toEntry(row: DeliveryLogRowRecord): DeliveryLogEntry | null {
  const channel = NotificationChannelSchema.safeParse(row.channel);
  if (!channel.success) return null;
  return {
    id: row.id,
    channel: channel.data,
    templateKey: row.templateKey,
    eventType: row.eventType,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
  };
}
