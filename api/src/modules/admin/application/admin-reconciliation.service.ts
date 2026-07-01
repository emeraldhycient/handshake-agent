import { Inject, Injectable } from '@nestjs/common';

import type {
  ReconBreak,
  ReconBreakListResponse,
  ReconBreakSeverity,
  ReconStatus,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { ReconciliationConfig } from '../../../core/config/configuration';
import {
  RECONCILIATION_READ_REPOSITORY,
  type IReconciliationReadRepository,
  type ReconBreakKind,
  type ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';

/**
 * The settlement-reconciler tick cadence, in seconds. The reconciler runs on a
 * hard-coded every-2-minutes @Cron (SettlementReconciliationService) — the
 * decorator is evaluated at compile time and cannot read runtime config, so the
 * cadence is a fixed 2 minutes. Surfaced so the status bar can project the next run.
 */
const RECON_TICK_INTERVAL_SEC = 120;

/**
 * The reconciler cron is hard-wired ON (an always-scheduled `@Cron`), so the status
 * bar reports it enabled. There is no runtime disable flag — pausing the reconciler
 * would be a code change + redeploy (an infra parameter per root §7), not an admin
 * toggle. Modeled as a documented constant rather than a fabricated config read.
 */
const RECON_CRON_ENABLED = true;

/** Fallback stale window when the reconciliation config is absent. */
const DEFAULT_STALE_AFTER_SEC = 120;

/** Break kind → severity: over/duplicate credits are high; the rest are medium. */
const SEVERITY_BY_KIND: Record<ReconBreakKind, ReconBreakSeverity> = {
  over_credit: 'high',
  duplicate_credit: 'high',
  amount_mismatch: 'medium',
  missing_settlement: 'medium',
};

/**
 * Phase 6b — the admin RECONCILIATION service (READ-ONLY). Projects the
 * provider-vs-ledger break list + the reconciliation-cron status bar for the
 * operator Reconciliation screen.
 *
 * It NEVER moves money (§3.1) and holds no Prisma import — it reaches data only
 * through the injected RECONCILIATION_READ_REPOSITORY port (§3.2). Over-credits are
 * surfaced for human action, never auto-debited; the resolve/accept/escalate/run-now
 * WRITES are deferred to Phase 7. No PII crosses this boundary — breaks reference
 * their transaction by opaque id only (§3.4). Decimals are strings; dates are ISO.
 */
@Injectable()
export class AdminReconciliationService {
  constructor(
    @Inject(RECONCILIATION_READ_REPOSITORY)
    private readonly repo: IReconciliationReadRepository,
    private readonly config: EffectiveConfigService,
  ) {}

  /** The provider-vs-ledger break list, newest-first (every break is `open`). */
  async listBreaks(): Promise<ReconBreakListResponse> {
    const rows = await this.repo.listBreaks(this.staleAfterSec());
    return { items: rows.map((row) => toBreak(row)) };
  }

  /**
   * The reconciliation-cron status bar: enablement, last/next run, tick cadence, and
   * the current open-break count (computed from the same break projection so the
   * bar and the list can never disagree).
   */
  async status(): Promise<ReconStatus> {
    const [cron, breaks] = await Promise.all([
      this.repo.cronStatus(RECON_TICK_INTERVAL_SEC),
      this.repo.listBreaks(this.staleAfterSec()),
    ]);
    return {
      enabled: RECON_CRON_ENABLED,
      lastRunAt: cron.lastRunAt !== null ? cron.lastRunAt.toISOString() : null,
      nextRunAt: cron.nextRunAt !== null ? cron.nextRunAt.toISOString() : null,
      intervalSeconds: RECON_TICK_INTERVAL_SEC,
      openBreakCount: breaks.length,
    };
  }

  /** The stale window (seconds) after which a pending settlement is a break. */
  private staleAfterSec(): number {
    const recon = this.config.get<ReconciliationConfig | undefined>(
      'reconciliation',
    );
    return recon?.gracePeriodSec ?? DEFAULT_STALE_AFTER_SEC;
  }
}

// ── mapper (record → contract shape) ────────────────────────────────────────────────

/** Projects a break record into the contract shape, deriving its severity. */
function toBreak(row: ReconBreakRecord): ReconBreak {
  return {
    id: row.id,
    kind: row.kind,
    severity: SEVERITY_BY_KIND[row.kind],
    transactionId: row.transactionId,
    asset: row.asset,
    delta: row.delta,
    detail: row.detail,
    // Every projected break is open — the resolved/accepted/escalated outcomes are
    // Phase-7 writes and cannot be produced on read today.
    status: 'open',
    detectedAt: row.detectedAt.toISOString(),
  };
}
