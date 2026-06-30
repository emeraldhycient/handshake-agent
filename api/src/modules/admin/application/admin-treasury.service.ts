import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  TreasuryAlert,
  TreasuryAlertListResponse,
  TreasuryBalancesResponse,
  TreasuryExposureListResponse,
  WithdrawalPolicyListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  TREASURY_READ_REPOSITORY,
  type ITreasuryReadRepository,
  type TreasuryAlertListFilter,
  type TreasuryAlertRecord,
} from '../../treasury/application/ports/treasury-read.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';

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

  // ── private helpers ────────────────────────────────────────────────────────────

  /** Locates a single alert by id among the bounded feed (acknowledged or not). */
  private async findAlert(id: string): Promise<TreasuryAlertRecord | null> {
    const all = await this.treasury.listAlerts({});
    return all.find((a) => a.id === id) ?? null;
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

function toIso(value: Date | null): string | null {
  return value !== null ? value.toISOString() : null;
}
