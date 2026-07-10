import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  TreasuryAlert,
  TreasuryAlertListResponse,
  TreasuryBalancesResponse,
  TreasuryExposureListResponse,
  TreasuryFiatFloatResponse,
  TreasuryFiatFloatStatus,
  TreasuryFxDirection,
  TreasuryFxPositionResponse,
  TreasuryPayoutQueueResponse,
  TreasurySweepListResponse,
  WithdrawalPolicyListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import {
  TREASURY_READ_REPOSITORY,
  type ITreasuryReadRepository,
  type TreasuryAlertListFilter,
  type TreasuryAlertRecord,
  type TreasuryFiatFloatRecord,
  type TreasuryFxPositionRecord,
  type TreasuryPayoutQueueRecord,
} from '../../treasury/application/ports/treasury-read.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { toIso } from './iso-date.util';

// Config keys (admin-tunable AppSetting overlay, root §7). Absent → fall back to a
// documented constant so the endpoint stays live before the keys are seeded.
const FIAT_FLOAT_TARGETS_KEY = 'treasury.fiatFloatTargets';
const LOW_FLOAT_THRESHOLD_BPS_KEY = 'treasury.lowFloatThresholdBps';
/**
 * Per-currency large-payout approval thresholds (major units, keyed by fiat code).
 * A queued payout whose fiat notional — in its OWN currency — is at/above the
 * threshold must clear maker-checker before release. FAIL-CLOSED: a currency with
 * no configured threshold flags EVERY payout for approval until an operator sets
 * one (registered per-currency in SETTING_REGISTRY as
 * `treasury.largePayoutThresholds.<CODE>`; JSON defaults in configuration.ts).
 */
const LARGE_PAYOUT_THRESHOLDS_KEY = 'treasury.largePayoutThresholds';
/** Default low-float floor when unset: a float under 25% of target is "low". */
const DEFAULT_LOW_FLOAT_THRESHOLD_BPS = 2500;
/** Basis-point scale (100% = 10 000 bps). */
const BPS_SCALE = 10000;

/**
 * Phase 3 (sub-area D) — the admin TREASURY OVERSIGHT service: aggregated
 * custodial balances, real-time exposure-vs-limit snapshots, threshold alerts,
 * and active per-wallet withdrawal policies.
 *
 * It NEVER moves money (§3.1) and holds no Prisma import — it reaches data only
 * through the injected TREASURY_READ_REPOSITORY port (§3.2). The single write,
 * acknowledging an alert, is audited as an `admin_override`. Decimals are
 * surfaced as byte-stable strings and dates as ISO.
 */
@Injectable()
export class AdminTreasuryService {
  constructor(
    @Inject(TREASURY_READ_REPOSITORY)
    private readonly treasury: ITreasuryReadRepository,
    private readonly audit: AuditService,
    private readonly config: EffectiveConfigService,
    private readonly registry: AssetRegistry,
  ) {}

  // ── balances ─────────────────────────────────────────────────────────────────

  async getBalances(): Promise<TreasuryBalancesResponse> {
    const rows = await this.treasury.aggregateBalances();
    return {
      balances: rows.map((r) => ({
        network: r.network,
        asset: r.asset,
        totalAmount: r.totalAmount,
        walletCount: r.walletCount,
      })),
    };
  }

  // ── exposure ─────────────────────────────────────────────────────────────────

  async listExposures(): Promise<TreasuryExposureListResponse> {
    const rows = await this.treasury.listExposures();
    return {
      items: rows.map((r) => ({
        id: r.id,
        asset: r.asset,
        fiatCurrency: r.fiatCurrency,
        cryptoHeld: r.cryptoHeld,
        fiatEquivalent: r.fiatEquivalent,
        netExposure: r.netExposure,
        exposureLimitBps: r.exposureLimitBps,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ── alerts ───────────────────────────────────────────────────────────────────

  async listAlerts(
    filter: TreasuryAlertListFilter,
  ): Promise<TreasuryAlertListResponse> {
    const rows = await this.treasury.listAlerts(filter);
    return { items: rows.map((r) => toAlert(r)) };
  }

  /**
   * Acknowledges a treasury alert and audits it as an admin override. Re-reads
   * the alert before and after so a missing alert fails with a NotFound (the
   * controller maps it to 404) rather than a silent no-op.
   */
  async acknowledgeAlert(
    id: string,
    adminId: string,
    note: string | undefined,
  ): Promise<TreasuryAlert> {
    const existing = await this.findAlert(id);
    if (existing === null) throw new AdminNotFoundError('Treasury alert');

    await this.treasury.acknowledgeAlert(id, adminId, note, new Date());

    const after = await this.findAlert(id);
    if (after === null) throw new AdminNotFoundError('Treasury alert');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `TreasuryAlert:${id}`,
      action: 'admin_override',
      before: { acknowledgedAt: toIso(existing.acknowledgedAt) },
      after: {
        acknowledgedAt: toIso(after.acknowledgedAt),
        note: note ?? null,
      },
    });
    return toAlert(after);
  }

  // ── withdrawal policies ────────────────────────────────────────────────────────

  async listWithdrawalPolicies(): Promise<WithdrawalPolicyListResponse> {
    const rows = await this.treasury.listWithdrawalPolicies();
    return {
      items: rows.map((r) => ({
        id: r.id,
        walletId: r.walletId,
        maxWithdrawalPerTx: r.maxWithdrawalPerTx,
        maxWithdrawalPerDay: r.maxWithdrawalPerDay,
        requiresApproval: r.requiresApproval,
        allowListMode: r.allowListMode,
        enabledAt: r.enabledAt.toISOString(),
      })),
    };
  }

  // ── child-address sweeps (Phase 6b, READ) ──────────────────────────────────────

  async listSweeps(): Promise<TreasurySweepListResponse> {
    const feed = await this.treasury.listSweeps();
    return {
      items: feed.rows.map((r) => ({
        id: r.id,
        address: r.address,
        network: r.network,
        asset: r.asset,
        balance: r.balance,
        status: r.status,
        lastSweptAt: toIso(r.lastSweptAt),
      })),
      sweepThreshold: feed.sweepThreshold,
      thresholdAsset: feed.thresholdAsset,
    };
  }

  // ── payout / withdrawal approval queue (Phase 6b, READ-ONLY) ─────────────────────

  async listPayoutQueue(): Promise<TreasuryPayoutQueueResponse> {
    const rows = await this.treasury.listPayoutQueue();
    const thresholds = this.largePayoutThresholds();
    const defaultFiat = this.registry.defaultFiat();
    return {
      items: rows.map((r) => this.toPayoutItem(r, thresholds, defaultFiat)),
    };
  }

  // ── Per-currency fiat float vs configured target (Phase 6b, READ) ────────────────

  async listFiatFloat(): Promise<TreasuryFiatFloatResponse> {
    const rows = await this.treasury.listFiatFloat();
    const targets = this.fiatFloatTargets();
    const thresholdBps = this.lowFloatThresholdBps();
    return { items: rows.map((r) => this.toFloat(r, targets, thresholdBps)) };
  }

  // ── FX position / exposure headroom (Phase 6b, READ) ─────────────────────────────

  async listFxPositions(): Promise<TreasuryFxPositionResponse> {
    const rows = await this.treasury.listFxPositions();
    return { items: rows.map((r) => toFxPosition(r)) };
  }

  // ── private helpers ────────────────────────────────────────────────────────────

  /** Locates a single alert by id among the bounded feed (acknowledged or not). */
  private async findAlert(id: string): Promise<TreasuryAlertRecord | null> {
    const all = await this.treasury.listAlerts({});
    return all.find((a) => a.id === id) ?? null;
  }

  /** Configured per-currency target float (admin-tunable; absent → {}). */
  private fiatFloatTargets(): Record<string, number> {
    return (
      this.config.get<Record<string, number> | undefined>(
        FIAT_FLOAT_TARGETS_KEY,
      ) ?? {}
    );
  }

  /** Configured per-currency large-payout thresholds (admin-tunable; absent → {}). */
  private largePayoutThresholds(): Record<string, number> {
    return (
      this.config.get<Record<string, number> | undefined>(
        LARGE_PAYOUT_THRESHOLDS_KEY,
      ) ?? {}
    );
  }

  /**
   * Maps a payout record to its wire item, deriving the maker-checker flag against
   * the threshold FOR THE PAYOUT'S OWN CURRENCY. The notional is the metadata fiat
   * leg when present; when the payout asset IS the fiat itself, the amount is
   * already fiat. FAIL-CLOSED (§3.6): no configured threshold for the currency →
   * requiresApproval, whatever the size — an operator must set a threshold before
   * any payout in that currency auto-clears the queue.
   */
  private toPayoutItem(
    r: TreasuryPayoutQueueRecord,
    thresholds: Record<string, number>,
    defaultFiat: string,
  ): TreasuryPayoutQueueResponse['items'][number] {
    const fiatCurrency = r.fiatCurrency ?? defaultFiat;
    const threshold = thresholds[fiatCurrency];
    const fiatNotional = Number(
      r.fiatAmount ?? (r.asset === fiatCurrency ? r.amount : '0'),
    );
    const requiresApproval =
      threshold === undefined ? true : fiatNotional >= threshold;
    return {
      id: r.id,
      transactionId: r.transactionId,
      beneficiaryLabel: r.beneficiaryLabel,
      reference: r.reference,
      method: r.method,
      asset: r.asset,
      amount: r.amount,
      fiatAmount: r.fiatAmount,
      fiatCurrency,
      requiresApproval,
      submittedAt: r.submittedAt.toISOString(),
    };
  }

  /** Configured low-float floor in bps (admin-tunable; absent → default). */
  private lowFloatThresholdBps(): number {
    return (
      this.config.get<number | undefined>(LOW_FLOAT_THRESHOLD_BPS_KEY) ??
      DEFAULT_LOW_FLOAT_THRESHOLD_BPS
    );
  }

  /**
   * Derives utilization (balance/target in bps) + a healthy/low status. A missing or
   * zero target yields 0 utilization and a healthy status (no divide-by-zero, and a
   * float with no target cannot be "under target").
   */
  private toFloat(
    r: TreasuryFiatFloatRecord,
    targets: Record<string, number>,
    thresholdBps: number,
  ): TreasuryFiatFloatResponse['items'][number] {
    const target = targets[r.currency] ?? 0;
    const balance = Number(r.balance);
    const utilizationBps =
      target > 0 ? Math.round((balance / target) * BPS_SCALE) : 0;
    const status: TreasuryFiatFloatStatus =
      target > 0 && utilizationBps < thresholdBps ? 'low' : 'healthy';
    return {
      currency: r.currency,
      balance: r.balance,
      targetFloat: String(target),
      utilizationBps,
      status,
      lowFloatThresholdBps: thresholdBps,
    };
  }
}

// ── mappers (record → contract shape) ──────────────────────────────────────────────

function toAlert(r: TreasuryAlertRecord): TreasuryAlert {
  return {
    id: r.id,
    asset: r.asset,
    severity: r.severity,
    message: r.message,
    netExposure: r.netExposure,
    triggeredAt: r.triggeredAt.toISOString(),
    acknowledgedAt: toIso(r.acknowledgedAt),
  };
}

/**
 * Derives the FX position card: direction from the sign of the net position, and
 * headroom = (limit − exposure)/limit in bps, clamped to ≥ 0. The exposure ratio is
 * netExposure / fiatEquivalent (both in fiat) expressed in bps; when the reference
 * value is zero the ratio is treated as 0 (full headroom).
 */
function toFxPosition(
  r: TreasuryFxPositionRecord,
): TreasuryFxPositionResponse['items'][number] {
  const net = Number(r.netPositionFiat);
  const direction: TreasuryFxDirection =
    net > 0 ? 'long' : net < 0 ? 'short' : 'flat';

  const reference = Number(r.fiatEquivalent);
  const exposureBps =
    reference > 0 ? (Number(r.netExposure) / reference) * BPS_SCALE : 0;
  const limit = r.exposureLimitBps;
  const headroomBps =
    limit > 0
      ? Math.max(0, Math.round(((limit - exposureBps) / limit) * BPS_SCALE))
      : 0;

  return {
    asset: r.asset,
    fiatCurrency: r.fiatCurrency,
    netPositionFiat: r.netPositionFiat,
    direction,
    headroomBps,
    exposureStatus: r.status,
  };
}
