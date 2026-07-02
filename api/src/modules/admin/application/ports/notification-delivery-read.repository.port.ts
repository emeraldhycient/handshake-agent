/**
 * DI token + port for the admin NOTIFICATION-DELIVERY read repository (Phase 6b,
 * Comms READ enrichment).
 *
 * READ-ONLY delivery-log signals for the operator Comms console's delivery-log
 * card — one row per issued `Notification` (channel / template / event / issue-time
 * / derived status) plus aggregate bounce/complaint stats from the per-attempt
 * `ChannelOutboundDispatch` rows. There is no notifications-oversight home module,
 * so the admin layer owns this read (mirrors METRICS_OPS_READ_REPOSITORY).
 *
 * The concrete Prisma adapter lives in `admin/infrastructure`; application/domain
 * depend only on this abstraction (clean-arch §4.1, CLAUDE.md §3.2). Nothing here
 * mutates anything (§3.1); no PII crosses this boundary — only opaque event refs +
 * template/event identifiers (§3.4).
 */
export const NOTIFICATION_DELIVERY_READ_REPOSITORY = Symbol(
  'NOTIFICATION_DELIVERY_READ_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/** A delivery attempt's derived terminal state (mirrors the contract enum). */
export type DeliveryRowStatus =
  | 'delivered'
  | 'sent'
  | 'sending'
  | 'bounced'
  | 'failed';

/** One issued notification projected into a delivery-log row. */
export interface DeliveryLogRowRecord {
  id: string;
  /** The notification's primary channel (whatsapp/email/sms/in_app). */
  channel: string;
  /** The template key that rendered it, or null for a plain fallback. */
  templateKey: string | null;
  /** The triggering domain event type (e.g. `kyc_approved`). */
  eventType: string;
  createdAt: Date;
  status: DeliveryRowStatus;
}

/** Aggregate bounce/complaint counts over the sampled dispatch window. */
export interface DeliveryStatsRecord {
  /** Dispatch attempts that ended `bounced`. */
  bouncedCount: number;
  /**
   * Dispatch attempts that surfaced a spam/complaint signal. 0 when the provider
   * exposes none — never fabricated.
   */
  complaintCount: number;
  /** Total dispatch attempts the counts were computed over. */
  totalDispatches: number;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface INotificationDeliveryReadRepository {
  /**
   * The most recent `limit` issued notifications projected into delivery-log
   * rows, newest first. No PII — opaque refs / template + event identifiers only.
   */
  recentDeliveries(limit: number): Promise<DeliveryLogRowRecord[]>;

  /**
   * Aggregate bounce/complaint counts over the most recent `sampleWindow`
   * dispatch attempts.
   */
  deliveryStats(sampleWindow: number): Promise<DeliveryStatsRecord>;
}
