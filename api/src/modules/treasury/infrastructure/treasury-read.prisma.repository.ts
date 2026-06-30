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

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ITreasuryReadRepository,
  TreasuryAlertListFilter,
  TreasuryAlertRecord,
  TreasuryBalanceRecord,
  TreasuryExposureRecord,
  WithdrawalPolicyRecord,
} from '../application/ports/treasury-read.repository.port';

/** Cap on the bounded exposure / alert / policy feeds (newest-first). */
const FEED_LIMIT = 100;

@Injectable()
export class TreasuryReadPrismaRepository implements ITreasuryReadRepository {
  constructor(private readonly prisma: PrismaService) {}

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
}
