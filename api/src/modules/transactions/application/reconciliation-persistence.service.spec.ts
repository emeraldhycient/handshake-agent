import { Logger } from '@nestjs/common';

import { ReconciliationPersistenceService } from './reconciliation-persistence.service';
import type {
  IReconciliationRepository,
  ReconBreakRecord,
  ReconRunRecord,
} from './ports/reconciliation.repository.port';
import type {
  SettlementReconciliationService,
  SettlementReconSummary,
} from './settlement-reconciliation.service';
import type { AssetReconciliationResult } from '../../wallets/application/wallet-reconciliation.service';

function makeRun(overrides: Partial<ReconRunRecord> = {}): ReconRunRecord {
  return {
    id: 'run-1',
    runType: 'settlement_outbox',
    status: 'running',
    totalChecked: 0,
    breaksDetected: 0,
    startedAt: new Date('2026-07-04T00:00:00Z'),
    completedAt: null,
    createdAt: new Date('2026-07-04T00:00:00Z'),
    ...overrides,
  };
}

describe('ReconciliationPersistenceService', () => {
  let repo: jest.Mocked<IReconciliationRepository>;
  let settlement: { tick: jest.Mock };
  let service: ReconciliationPersistenceService;
  const calls: string[] = [];

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    calls.length = 0;

    repo = {
      createRun: jest.fn(() => {
        calls.push('createRun');
        return Promise.resolve(makeRun());
      }),
      recordBreak: jest.fn(() => {
        calls.push('recordBreak');
        return Promise.resolve({} as ReconBreakRecord);
      }),
      completeRun: jest.fn(() => {
        calls.push('completeRun');
        return Promise.resolve();
      }),
      listRuns: jest.fn(),
      findRun: jest.fn(),
      listBreaksByRun: jest.fn(),
      findBreak: jest.fn(),
      findBreaksByUser: jest.fn(),
      updateBreakStatus: jest.fn(),
    } as unknown as jest.Mocked<IReconciliationRepository>;

    settlement = {
      tick: jest.fn((): Promise<SettlementReconSummary> => {
        calls.push('tick');
        return Promise.resolve({ totalChecked: 0, failures: [] });
      }),
    };

    service = new ReconciliationPersistenceService(
      repo,
      settlement as unknown as SettlementReconciliationService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  // ── settlement reconciliation ──────────────────────────────────────────────

  it('persist-first: creates the run BEFORE running the batch', async () => {
    await service.runSettlementReconciliation();
    expect(calls.indexOf('createRun')).toBeLessThan(calls.indexOf('tick'));
    expect(repo.createRun).toHaveBeenCalledWith({
      runType: 'settlement_outbox',
    });
  });

  it('records a settlement_failure break per failed row and completes the run with tallies', async () => {
    settlement.tick.mockResolvedValue({
      totalChecked: 3,
      failures: [
        {
          outboxId: 'obx-1',
          transactionId: 'txn-1',
          settlementType: 'processor_payout',
          reason: 'provider timeout',
        },
        {
          outboxId: 'obx-2',
          transactionId: 'txn-2',
          settlementType: 'onchain_send',
          reason: 'rpc error',
        },
      ],
    });

    await service.runSettlementReconciliation();

    expect(repo.recordBreak).toHaveBeenCalledTimes(2);
    expect(repo.recordBreak).toHaveBeenCalledWith(
      expect.objectContaining({
        reconRunId: 'run-1',
        breakType: 'settlement_failure',
        outboxId: 'obx-1',
      }),
    );
    expect(repo.completeRun).toHaveBeenCalledWith('run-1', {
      status: 'completed',
      totalChecked: 3,
      breaksDetected: 2,
    });
  });

  it('completes a clean run with zero breaks (no recordBreak)', async () => {
    settlement.tick.mockResolvedValue({ totalChecked: 5, failures: [] });
    await service.runSettlementReconciliation();
    expect(repo.recordBreak).not.toHaveBeenCalled();
    expect(repo.completeRun).toHaveBeenCalledWith('run-1', {
      status: 'completed',
      totalChecked: 5,
      breaksDetected: 0,
    });
  });

  it('marks the run failed and rethrows when the batch throws', async () => {
    settlement.tick.mockRejectedValue(new Error('db down'));
    await expect(service.runSettlementReconciliation()).rejects.toThrow(
      'db down',
    );
    expect(repo.completeRun).toHaveBeenCalledWith('run-1', {
      status: 'failed',
      totalChecked: 0,
      breaksDetected: 0,
    });
    expect(repo.recordBreak).not.toHaveBeenCalled();
  });

  // ── the cron wrapper ───────────────────────────────────────────────────────

  it('cron tick swallows batch errors so the scheduler is never wedged', async () => {
    settlement.tick.mockRejectedValue(new Error('boom'));
    await expect(
      service.settlementReconciliationTick(),
    ).resolves.toBeUndefined();
  });

  it('cron tick skips an overlapping run while one is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    settlement.tick.mockImplementation(async () => {
      await gate;
      return { totalChecked: 0, failures: [] };
    });

    const first = service.settlementReconciliationTick();
    await Promise.resolve();
    await Promise.resolve();
    await service.settlementReconciliationTick(); // overlaps — must skip
    expect(repo.createRun).toHaveBeenCalledTimes(1);

    release();
    await first;
    await service.settlementReconciliationTick(); // guard released → runs
    expect(repo.createRun).toHaveBeenCalledTimes(2);
  });

  // ── wallet reconciliation persistence ──────────────────────────────────────

  it('persistWalletRun records over_credit + balance_mismatch breaks and skips in-sync', async () => {
    repo.createRun.mockResolvedValue(
      makeRun({ id: 'wrun', runType: 'wallet_deposit' }),
    );
    const results: AssetReconciliationResult[] = [
      {
        asset: 'USDT',
        network: 'TRON',
        walletId: 'wal-1',
        onChain: '10',
        ledger: '60',
        delta: '-50',
        action: 'over_credit_flagged',
      },
      {
        asset: 'USDT',
        network: 'TRON',
        walletId: 'wal-2',
        onChain: '75',
        ledger: '25',
        delta: '50',
        action: 'credited',
        deposited: true,
      },
      {
        asset: 'USDT',
        network: 'TRON',
        walletId: 'wal-3',
        onChain: '5',
        ledger: '5',
        delta: '0',
        action: 'in_sync',
      },
      {
        asset: 'USDT',
        network: 'TRON',
        walletId: 'wal-4',
        onChain: '9',
        ledger: '9',
        delta: '2',
        action: 'already_credited',
        deposited: false,
      },
    ];

    const run = await service.persistWalletRun('user-9', results);

    expect(run.id).toBe('wrun');
    expect(repo.createRun).toHaveBeenCalledWith({ runType: 'wallet_deposit' });
    // over_credit_flagged → over_credit / detected
    expect(repo.recordBreak).toHaveBeenCalledWith(
      expect.objectContaining({
        reconRunId: 'wrun',
        breakType: 'over_credit',
        status: 'detected',
        userId: 'user-9',
        walletId: 'wal-1',
        currency: 'USDT',
        delta: '-50',
      }),
    );
    // credited → balance_mismatch / resolved (engine already remediated)
    expect(repo.recordBreak).toHaveBeenCalledWith(
      expect.objectContaining({
        breakType: 'balance_mismatch',
        status: 'resolved',
        walletId: 'wal-2',
        delta: '50',
      }),
    );
    // in_sync + already_credited → no break
    expect(repo.recordBreak).toHaveBeenCalledTimes(2);
    expect(repo.completeRun).toHaveBeenCalledWith('wrun', {
      status: 'completed',
      totalChecked: 4,
      breaksDetected: 2,
    });
  });
});
