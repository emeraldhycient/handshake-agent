import { AdminOpsService } from './admin-ops.service';
import type {
  IOpsReadRepository,
  OpsBoardResult,
} from './ports/ops-read.repository.port';

function makeBoard(): OpsBoardResult {
  return {
    providers: [
      {
        key: 'blockradar',
        name: 'Blockradar',
        health: 'ok',
        lastLatencyMs: 120,
      },
      {
        key: 'flutterwave',
        name: 'Flutterwave',
        health: 'warn',
        lastLatencyMs: null,
      },
    ],
    webhookQueues: [
      { key: 'blockradar.deposit', depth: 0, retries: 0, health: 'ok' },
      { key: 'whatsapp.inbound', depth: 12, retries: 4, health: 'down' },
    ],
    jobs: [
      {
        id: 'settlement-reconciliation',
        name: 'Reconciliation sweep',
        schedule: '*/2 * * * *',
        lastRunAt: new Date('2026-07-01T09:00:00.000Z'),
        status: 'ok',
        health: 'ok',
      },
      {
        id: 'sanctions-refresh',
        name: 'Sanctions list refresh',
        schedule: '0 3 * * *',
        lastRunAt: null,
        status: 'idle',
        health: 'ok',
      },
    ],
  };
}

describe('AdminOpsService', () => {
  let repo: jest.Mocked<IOpsReadRepository>;
  let service: AdminOpsService;

  beforeEach(() => {
    repo = { board: jest.fn().mockResolvedValue(makeBoard()) };
    service = new AdminOpsService(repo);
  });

  describe('board', () => {
    it('passes the provider board through unchanged', async () => {
      const result = await service.board();
      expect(result.providers).toEqual(makeBoard().providers);
    });

    it('passes the webhook queues through unchanged', async () => {
      const result = await service.board();
      expect(result.webhookQueues).toEqual(makeBoard().webhookQueues);
    });

    it('serializes each job lastRunAt Date to an ISO string (null stays null)', async () => {
      const result = await service.board();
      expect(result.jobs).toEqual([
        {
          id: 'settlement-reconciliation',
          name: 'Reconciliation sweep',
          schedule: '*/2 * * * *',
          lastRunAt: '2026-07-01T09:00:00.000Z',
          status: 'ok',
          health: 'ok',
        },
        {
          id: 'sanctions-refresh',
          name: 'Sanctions list refresh',
          schedule: '0 3 * * *',
          lastRunAt: null,
          status: 'idle',
          health: 'ok',
        },
      ]);
    });

    it('reads the board exactly once', async () => {
      await service.board();
      expect(repo.board).toHaveBeenCalledTimes(1);
    });
  });
});
