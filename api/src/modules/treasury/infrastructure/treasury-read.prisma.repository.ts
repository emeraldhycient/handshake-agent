/**
 * Prisma adapter for ITreasuryReadRepository (admin TREASURY oversight, Phase 3
 * sub-area D).
 *
 * Infrastructure layer only — the only place in this feature that imports the
 * generated Prisma client / PrismaService (dependency-cruiser rule §3.2). Maps
 * Prisma rows → application-layer records; the service never sees Prisma types.
 *
 * `aggregateBalances` is the one non-trivial read: WalletBalance is an append-only
 * SNAPSHOT table (many rows per wallet+asset over time), so naively SUM-ing every
 * row would double-count history. We take the LATEST snapshot per (walletId, asset)
 * via `DISTINCT ON`, join the wallet for its network, then aggregate per
 * (network, asset). Decimals are cast to text so the engine-precision values stay
 * byte-stable strings (never a JS float).
 */

import { Injectable } from '@nestjs/common';

import {
  SettlementOutboxStatus,
  SettlementType,
} from '../../../../generated/prisma/client';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ITreasuryReadRepository,
  TreasuryAlertListFilter,
  TreasuryAlertRecord,
  TreasuryBalanceRecord,
  TreasuryExposureRecord,
  TreasuryFiatFloatRecord,
  TreasuryFxPositionRecord,
  TreasuryPayoutQueueRecord,
  TreasurySweepFeed,
  TreasurySweepRecord,
  WithdrawalPolicyRecord,
} from '../application/ports/treasury-read.repository.port';

/** Cap on the bounded exposure / alert / policy feeds (newest-first). */
const FEED_LIMIT = 100;

/**
 * Neutral fallback for a display value we genuinely cannot derive from metadata
 * or the catalog. Deliberately NOT a currency/asset symbol so a non-NGN payout
 * whose metadata is missing is never MISLABELED with a hardcoded 'NGN'/'USDT'
 * (A9). Callers still prefer the real value from metadata / the registry default.
 */
const UNKNOWN_LABEL = 'unknown';

/**
 * Configured gas-sweep threshold (native TRX) for child TRON addresses. This is the
 * `sweep.threshold.trx` seed value; the operational sweep view compares each child's
 * gas balance to it. Surfaced through the feed so the FE footer needs no config read.
 */
const SWEEP_THRESHOLD_TRX = '25';
const SWEEP_THRESHOLD_ASSET = 'TRX';

/** Settlement types that represent an outbound payout awaiting release. */
const PAYOUT_SETTLEMENT_TYPES: SettlementType[] = [
  SettlementType.processor_payout,
  SettlementType.onchain_send,
];

/** Outbox statuses that mean "not yet released" (still in the approval queue). */
const PENDING_OUTBOX_STATUSES: SettlementOutboxStatus[] = [
  SettlementOutboxStatus.pending,
  SettlementOutboxStatus.enqueued,
  SettlementOutboxStatus.in_progress,
];

@Injectable()
export class TreasuryReadPrismaRepository implements ITreasuryReadRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AssetRegistry,
  ) {}

  /**
   * The catalog's base/settlement fiat, used as the display fallback for a payout
   * row whose metadata predates currency capture. Defensive: `defaultFiat()`
   * throws when no fiat is enabled, and this is a READ-ONLY display path that must
   * never crash the treasury console over a catalog edge — fall back to a neutral
   * label instead.
   */
  private resolveDefaultFiat(): string {
    try {
      return this.registry.defaultFiat();
    } catch {
      return UNKNOWN_LABEL;
    }
  }

  async aggregateBalances(): Promise<TreasuryBalanceRecord[]> {
    // latest: the most-recent snapshot per (walletId, asset).
    // Aggregate those latest rows by (network, asset): SUM(amount) cast to text
    // (byte-stable), COUNT(distinct walletId).
    const rows = await this.prisma.$queryRaw<
      Array<{
        network: string;
        asset: string;
        totalAmount: string;
        walletCount: bigint;
      }>
    >`
      WITH latest AS (
        SELECT DISTINCT ON (wb."walletId", wb.asset)
          wb."walletId" AS wallet_id,
          wb.asset      AS asset,
          wb.amount     AS amount
        FROM "wallet_balances" wb
        ORDER BY wb."walletId", wb.asset, wb."syncedAt" DESC
      )
      SELECT
        w.network::text                        AS network,
        latest.asset                           AS asset,
        SUM(latest.amount)::text               AS "totalAmount",
        COUNT(DISTINCT latest.wallet_id)::bigint AS "walletCount"
      FROM latest
      JOIN "wallets" w ON w.id = latest.wallet_id
      GROUP BY w.network, latest.asset
      ORDER BY w.network::text ASC, latest.asset ASC
    `;

    return rows.map((row) => ({
      network: row.network,
      asset: row.asset,
      totalAmount: row.totalAmount,
      walletCount: Number(row.walletCount),
    }));
  }

  async listExposures(): Promise<TreasuryExposureRecord[]> {
    const rows = await this.prisma.treasuryExposure.findMany({
      where: { snapshotType: 'real_time' as never },
      select: {
        id: true,
        asset: true,
        fiatCurrency: true,
        cryptoHeld: true,
        fiatEquivalent: true,
        netExposure: true,
        exposureLimitBps: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: FEED_LIMIT,
    });

    return rows.map((row) => ({
      id: row.id,
      asset: row.asset,
      fiatCurrency: row.fiatCurrency,
      cryptoHeld: row.cryptoHeld,
      fiatEquivalent: row.fiatEquivalent.toString(),
      netExposure: row.netExposure.toString(),
      exposureLimitBps: row.exposureLimitBps,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  async listAlerts(
    filter: TreasuryAlertListFilter,
  ): Promise<TreasuryAlertRecord[]> {
    const rows = await this.prisma.treasuryAlert.findMany({
      where:
        filter.acknowledged === undefined
          ? {}
          : filter.acknowledged
            ? { acknowledgedAt: { not: null } }
            : { acknowledgedAt: null },
      select: {
        id: true,
        asset: true,
        severity: true,
        message: true,
        netExposure: true,
        triggeredAt: true,
        acknowledgedAt: true,
      },
      orderBy: [{ triggeredAt: 'desc' }, { id: 'desc' }],
      take: FEED_LIMIT,
    });

    return rows.map((row) => ({
      id: row.id,
      asset: row.asset,
      severity: row.severity,
      message: row.message,
      netExposure: row.netExposure.toString(),
      triggeredAt: row.triggeredAt,
      acknowledgedAt: row.acknowledgedAt,
    }));
  }

  async acknowledgeAlert(
    id: string,
    adminId: string,
    note: string | undefined,
    at: Date,
  ): Promise<void> {
    await this.prisma.treasuryAlert.update({
      where: { id },
      data: {
        acknowledgedAt: at,
        acknowledgedByAdminId: adminId,
        acknowledgmentNote: note ?? null,
      },
    });
  }

  async listWithdrawalPolicies(): Promise<WithdrawalPolicyRecord[]> {
    const rows = await this.prisma.withdrawalPolicy.findMany({
      where: { disabledAt: null },
      select: {
        id: true,
        walletId: true,
        maxWithdrawalPerTx: true,
        maxWithdrawalPerDay: true,
        requiresApproval: true,
        allowListMode: true,
        enabledAt: true,
      },
      orderBy: [{ enabledAt: 'desc' }, { id: 'desc' }],
      take: FEED_LIMIT,
    });

    return rows.map((row) => ({
      id: row.id,
      walletId: row.walletId,
      maxWithdrawalPerTx:
        row.maxWithdrawalPerTx !== null
          ? row.maxWithdrawalPerTx.toString()
          : null,
      maxWithdrawalPerDay:
        row.maxWithdrawalPerDay !== null
          ? row.maxWithdrawalPerDay.toString()
          : null,
      requiresApproval: row.requiresApproval,
      allowListMode: row.allowListMode,
      enabledAt: row.enabledAt,
    }));
  }

  /**
   * Child-address gas-sweep view. Each row is a real per-user child receive address
   * (Wallet.address) with its latest native-gas (TRX) balance snapshot and a derived
   * sweep lifecycle relative to the configured threshold. The gas balance is the
   * latest WalletBalance snapshot for the network's native asset; the last-sweep
   * timestamp is the wallet's `lastSyncedAt` (the sweep runs on the sync cycle).
   */
  async listSweeps(): Promise<TreasurySweepFeed> {
    const wallets = await this.prisma.wallet.findMany({
      where: { status: 'active' as never },
      select: {
        id: true,
        address: true,
        network: true,
        lastSyncedAt: true,
        balances: {
          where: { asset: SWEEP_THRESHOLD_ASSET },
          orderBy: { syncedAt: 'desc' },
          take: 1,
          select: { amount: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FEED_LIMIT,
    });

    const threshold = Number(SWEEP_THRESHOLD_TRX);
    const rows: TreasurySweepRecord[] = wallets.map((w) => {
      const balance = w.balances[0]?.amount.toString() ?? '0';
      const status = deriveSweepStatus(
        Number(balance),
        threshold,
        w.lastSyncedAt,
      );
      return {
        id: w.id,
        address: w.address,
        network: w.network,
        asset: SWEEP_THRESHOLD_ASSET,
        balance,
        status,
        // Swept rows carry the last sync as the sweep time; otherwise null.
        lastSweptAt: status === 'swept' ? w.lastSyncedAt : null,
      };
    });

    return {
      rows,
      sweepThreshold: SWEEP_THRESHOLD_TRX,
      thresholdAsset: SWEEP_THRESHOLD_ASSET,
    };
  }

  /**
   * Pending outbound settlements awaiting release: processor payouts + on-chain
   * sends whose outbox status is not yet terminal. READ ONLY — never releases funds
   * (§3.1). Beneficiary label + method are derived from the settlement type and the
   * joined transaction metadata; the reference prefers the processor ref.
   */
  async listPayoutQueue(): Promise<TreasuryPayoutQueueRecord[]> {
    const rows = await this.prisma.settlementOutbox.findMany({
      where: {
        settlementType: { in: PAYOUT_SETTLEMENT_TYPES },
        status: { in: PENDING_OUTBOX_STATUSES },
      },
      select: {
        id: true,
        transactionId: true,
        settlementType: true,
        processorRef: true,
        createdAt: true,
        transaction: { select: { metadata: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FEED_LIMIT,
    });

    const defaultFiat = this.resolveDefaultFiat();
    return rows.map((row) => toPayoutRecord(row, defaultFiat));
  }

  /**
   * A single pending payout by its outbox id (Phase 7 — the approve maker-checker
   * needs the item's transactionId + reference). Returns null when the id is unknown
   * or the row is no longer in a pending state. READ-ONLY — never releases funds.
   */
  async findPayoutQueueItem(
    id: string,
  ): Promise<TreasuryPayoutQueueRecord | null> {
    const row = await this.prisma.settlementOutbox.findFirst({
      where: {
        id,
        settlementType: { in: PAYOUT_SETTLEMENT_TYPES },
        status: { in: PENDING_OUTBOX_STATUSES },
      },
      select: {
        id: true,
        transactionId: true,
        settlementType: true,
        processorRef: true,
        createdAt: true,
        transaction: { select: { metadata: true } },
      },
    });
    return row === null ? null : toPayoutRecord(row, this.resolveDefaultFiat());
  }

  /**
   * Running platform_float ledger balance per fiat currency: the LATEST ledger
   * entry's `balanceAfter` for each (currency) on the platform_float account,
   * via DISTINCT ON over the per-currency monotonic sequence. Byte-stable strings.
   */
  async listFiatFloat(): Promise<TreasuryFiatFloatRecord[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ currency: string; balance: string }>
    >`
      SELECT DISTINCT ON (le.currency)
        le.currency                 AS currency,
        le."balanceAfter"::text     AS balance
      FROM "ledger_entries" le
      WHERE le."accountType" = 'platform_float'
      ORDER BY le.currency, le.sequence DESC
    `;

    return rows.map((row) => ({
      currency: row.currency,
      balance: row.balance,
    }));
  }

  /**
   * Signed net FX inventory positions per (asset, fiat) with the underlying exposure
   * fields, from the latest real-time TreasuryExposure snapshots. The service derives
   * direction + headroom; here we project the raw exposure numbers as strings.
   */
  async listFxPositions(): Promise<TreasuryFxPositionRecord[]> {
    const rows = await this.prisma.treasuryExposure.findMany({
      where: { snapshotType: 'real_time' as never },
      select: {
        asset: true,
        fiatCurrency: true,
        netExposure: true,
        fiatEquivalent: true,
        exposureLimitBps: true,
        status: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: FEED_LIMIT,
    });

    return rows.map((row) => ({
      asset: row.asset,
      fiatCurrency: row.fiatCurrency,
      // The net inventory position valued in fiat is the exposure's fiat net.
      netPositionFiat: row.netExposure.toString(),
      netExposure: row.netExposure.toString(),
      fiatEquivalent: row.fiatEquivalent.toString(),
      exposureLimitBps: row.exposureLimitBps,
      status: row.status,
    }));
  }
}

// ── module-private derivations (infra-only presentation of operational state) ────────

/**
 * Sweep lifecycle: never synced → below_threshold (nothing gathered yet); balance
 * under the threshold → below_threshold; at/over threshold → pending (awaiting the
 * next sweep). A synced wallet whose gas is near-zero is treated as already swept.
 */
function deriveSweepStatus(
  balance: number,
  threshold: number,
  lastSyncedAt: Date | null,
): TreasurySweepRecord['status'] {
  if (lastSyncedAt !== null && balance < threshold * 0.05) return 'swept';
  if (balance >= threshold) return 'pending';
  return 'below_threshold';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The asset display fallback when a payout row's metadata carries no explicit
 * asset. For a fiat payout (processor_payout) this is the catalog default fiat,
 * NOT a hardcoded 'NGN' — so a non-NGN payout is never mislabeled (A9). For a
 * crypto send whose asset is unknown we surface a neutral label rather than
 * guessing a symbol.
 */
function defaultAssetFor(type: SettlementType, defaultFiat: string): string {
  return type === SettlementType.onchain_send ? UNKNOWN_LABEL : defaultFiat;
}

function methodFor(
  type: SettlementType,
  meta: Record<string, unknown>,
  defaultFiat: string,
): string {
  if (type === SettlementType.onchain_send) {
    return `${str(meta.asset) ?? UNKNOWN_LABEL} · Blockradar`;
  }
  // Read the ACTUAL payout currency from metadata; only fall back to the catalog
  // default fiat (never a hardcoded 'NGN') for rows that predate currency capture.
  const currency =
    str(meta.fiatCurrency) ?? str(meta.velocityFiatCurrency) ?? defaultFiat;
  return `${currency} payout · Flutterwave`;
}

function beneficiaryLabelFor(
  meta: Record<string, unknown>,
  type: SettlementType,
): string {
  const name = str(meta.beneficiaryName) ?? str(meta.bankName);
  if (name !== null) return name;
  // Neutral, currency/network-agnostic fallbacks so a non-NGN / non-TRON row is
  // never mislabeled with a hardcoded market or chain (A9).
  return type === SettlementType.onchain_send
    ? 'Crypto withdrawal'
    : 'Bank payout';
}

/** The selected settlement-outbox row shape shared by list + single-item reads. */
interface PayoutOutboxRow {
  id: string;
  transactionId: string;
  settlementType: SettlementType;
  processorRef: string | null;
  createdAt: Date;
  transaction: { metadata: unknown } | null;
}

/**
 * Projects one selected settlement-outbox row into a payout-queue record. Shared by
 * `listPayoutQueue` and `findPayoutQueueItem` so the list row and the single-item
 * lookup can never disagree on the derived fields (§13.2 DRY).
 *
 * `fiatCurrency` is read from the SAME transaction metadata the fiat leg comes
 * from (`meta.fiatCurrency`, written by the execution engine alongside
 * `meta.fiatAmount`). Rows whose metadata predates currency capture project null —
 * the service resolves the registry default fiat; NO 'NGN' literal here. The
 * large-payout approval flag is likewise a service concern (per-currency
 * layered-config thresholds), not derived in this projection.
 */
function toPayoutRecord(
  row: PayoutOutboxRow,
  defaultFiat: string,
): TreasuryPayoutQueueRecord {
  const meta = asRecord(row.transaction?.metadata);
  const asset =
    str(meta.asset) ?? defaultAssetFor(row.settlementType, defaultFiat);
  const amount = str(meta.amount) ?? str(meta.fiatAmount) ?? '0';
  // Sell/buy metadata carries the fiat leg as (fiatAmount, fiatCurrency); on-chain
  // SEND metadata carries the engine's fiat-equivalent as the velocity pair
  // (velocityFiatAmount, velocityFiatCurrency) instead — fall through so a large
  // send has a real notional for the approval gate rather than a silent 0.
  const fiatAmount =
    str(meta.fiatAmount) ?? str(meta.velocityFiatAmount) ?? null;
  const fiatCurrency = str(meta.fiatCurrency) ?? str(meta.velocityFiatCurrency);
  return {
    id: row.id,
    transactionId: row.transactionId,
    beneficiaryLabel: beneficiaryLabelFor(meta, row.settlementType),
    reference: row.processorRef ?? `wd_${row.transactionId.slice(0, 8)}`,
    method: methodFor(row.settlementType, meta, defaultFiat),
    asset,
    amount,
    fiatAmount,
    fiatCurrency,
    submittedAt: row.createdAt,
  };
}
