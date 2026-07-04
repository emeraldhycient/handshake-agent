import type { AuditService } from '../../../core/audit/application/audit.service';
import type {
  IWebhookEventRepository,
  WebhookEventRecord,
} from '../../webhooks/application/ports/webhook-event.repository.port';
import type { IWebhookDispatch } from '../../webhooks/application/ports/webhook-dispatch.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminWebhooksService } from './admin-webhooks.service';

function makeRecord(
  over: Partial<WebhookEventRecord> = {},
): WebhookEventRecord {
  return {
    id: 'wh-1',
    provider: 'blockradar',
    providerEventId: 'evt-1',
    payload: { event: 'deposit.success' },
    headers: { 'x-blockradar-signature': 'sig' },
    signature: 'sig',
    status: 'dead',
    attempts: 5,
    lastError: 'boom',
    receivedAt: new Date('2026-07-04T06:00:00.000Z'),
    lastAttemptAt: new Date('2026-07-04T06:05:00.000Z'),
    processedAt: null,
    deadAt: new Date('2026-07-04T06:06:00.000Z'),
    ...over,
  };
}

describe('AdminWebhooksService', () => {
  let repo: jest.Mocked<IWebhookEventRepository>;
  let dispatch: jest.Mocked<IWebhookDispatch>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: AdminWebhooksService;

  beforeEach(() => {
    repo = {
      createIfNew: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      markProcessing: jest.fn(),
      markSucceeded: jest.fn(),
      markFailed: jest.fn(),
      markDead: jest.fn(),
      resetToReceived: jest.fn().mockResolvedValue(undefined),
      findStuckReceived: jest.fn(),
      countByStatus: jest.fn(),
    };
    dispatch = { enqueue: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new AdminWebhooksService(
      repo,
      dispatch,
      audit as unknown as AuditService,
    );
  });

  describe('list', () => {
    it('maps records to ISO-string contract items + passes filters', async () => {
      repo.list.mockResolvedValue({
        items: [
          makeRecord({
            status: 'succeeded',
            processedAt: new Date('2026-07-04T06:01:00.000Z'),
          }),
        ],
        nextCursor: 'cur-2',
      });

      const res = await service.list({
        provider: 'blockradar',
        status: 'succeeded',
        limit: 25,
      });

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'blockradar',
          status: 'succeeded',
          limit: 25,
        }),
      );
      expect(res.nextCursor).toBe('cur-2');
      expect(res.items[0].receivedAt).toBe('2026-07-04T06:00:00.000Z');
      expect(res.items[0].processedAt).toBe('2026-07-04T06:01:00.000Z');
    });
  });

  describe('detail', () => {
    it('returns payload/headers/signature/timestamps', async () => {
      repo.findById.mockResolvedValue(makeRecord());
      const d = await service.detail('wh-1');
      expect(d.payload).toEqual({ event: 'deposit.success' });
      expect(d.headers['x-blockradar-signature']).toBe('sig');
      expect(d.deadAt).toBe('2026-07-04T06:06:00.000Z');
    });

    it('throws AdminNotFoundError for a missing id', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.detail('nope')).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });

  describe('retry', () => {
    it('re-arms, re-enqueues, and audits — never settles inline', async () => {
      repo.findById
        .mockResolvedValueOnce(makeRecord({ status: 'dead' })) // before
        .mockResolvedValueOnce(makeRecord({ status: 'received' })); // after

      const res = await service.retry('wh-1', 'admin-9', 'redeliver please');

      expect(repo.resetToReceived).toHaveBeenCalledWith('wh-1');
      expect(dispatch.enqueue).toHaveBeenCalledWith('wh-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: 'admin-9',
          action: 'admin_override',
          subject: 'WebhookEvent:wh-1',
        }),
      );
      const recorded = audit.record.mock.calls[0][0];
      expect(recorded.details).toMatchObject({ reason: 'redeliver please' });
      expect(res.status).toBe('received');
      // No settlement method exists on this service — money stays engine-brokered.
    });

    it('throws AdminNotFoundError when the webhook does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.retry('nope', 'admin-9', 'x'),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(dispatch.enqueue).not.toHaveBeenCalled();
    });
  });
});
