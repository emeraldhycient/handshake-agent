import { AdminNotificationBroadcastService } from './admin-notification-broadcast.service';
import type { IBroadcastDispatchRepository } from './ports/broadcast-dispatch.repository.port';
import type { AdminApprovalsService } from './admin-approvals.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { BroadcastSendRequest } from '@handshake-agent/contracts';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const CR_ID = '22222222-2222-4222-8222-222222222222';

function req(over: Partial<BroadcastSendRequest> = {}): BroadcastSendRequest {
  return {
    audience: 'lagos',
    templateKey: 'promo_ticketing',
    schedule: { kind: 'now' },
    reason: 'Launch promo',
    ...over,
  };
}

describe('AdminNotificationBroadcastService', () => {
  let dispatch: jest.Mocked<IBroadcastDispatchRepository>;
  let approvals: jest.Mocked<Pick<AdminApprovalsService, 'create'>>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let config: jest.Mocked<Pick<EffectiveConfigService, 'get'>>;
  let service: AdminNotificationBroadcastService;

  beforeEach(() => {
    dispatch = {
      countAudience: jest.fn(),
      enqueueBroadcast: jest.fn(),
    };
    approvals = {
      create: jest.fn().mockResolvedValue({ id: CR_ID }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    // Threshold sourced from the DB-admin layer; default returns 10_000.
    config = { get: jest.fn().mockReturnValue(10_000) };
    service = new AdminNotificationBroadcastService(
      dispatch,
      approvals as unknown as AdminApprovalsService,
      audit as unknown as AuditService,
      config as unknown as EffectiveConfigService,
    );
  });

  describe('small audience (below threshold) → direct dispatch', () => {
    it('enqueues through the outbox and returns dispatched', async () => {
      dispatch.countAudience.mockResolvedValue(2140);
      dispatch.enqueueBroadcast.mockResolvedValue({
        recipientCount: 2140,
        enqueuedCount: 2140,
      });

      const res = await service.send(req(), ADMIN);

      expect(dispatch.enqueueBroadcast).toHaveBeenCalledTimes(1);
      const arg = dispatch.enqueueBroadcast.mock.calls[0][0];
      expect(arg.audience).toBe('lagos');
      expect(arg.templateKey).toBe('promo_ticketing');
      expect(arg.sendAt).toBeNull();
      // A stable broadcastId anchors the outbox idempotency.
      expect(typeof arg.broadcastId).toBe('string');
      expect(arg.broadcastId.length).toBeGreaterThan(0);

      // NEVER queued for approval below the threshold.
      expect(approvals.create).not.toHaveBeenCalled();

      expect(res).toEqual({
        outcome: 'dispatched',
        recipientCount: 2140,
        changeRequestId: null,
      });
    });

    it('passes the future sendAt through for a scheduled send', async () => {
      const sendAt = '2026-07-02T09:00:00.000Z';
      dispatch.countAudience.mockResolvedValue(100);
      dispatch.enqueueBroadcast.mockResolvedValue({
        recipientCount: 100,
        enqueuedCount: 100,
      });

      await service.send(
        req({ schedule: { kind: 'scheduled', sendAt } }),
        ADMIN,
      );

      expect(dispatch.enqueueBroadcast.mock.calls[0][0].sendAt).toBe(sendAt);
    });

    it('audits the dispatch (admin_update, never a money action) and NEVER touches a ledger', async () => {
      dispatch.countAudience.mockResolvedValue(2140);
      dispatch.enqueueBroadcast.mockResolvedValue({
        recipientCount: 2140,
        enqueuedCount: 2140,
      });

      await service.send(req(), ADMIN);

      expect(audit.record).toHaveBeenCalledTimes(1);
      const rec = audit.record.mock.calls[0][0];
      expect(rec.actorAdminId).toBe(ADMIN);
      expect(rec.action).toBe('admin_update');
      expect(rec.subject).toContain('Broadcast:');
    });
  });

  describe('large audience (at/above threshold) → maker-checker', () => {
    it('raises a notification_broadcast ChangeRequest and dispatches NOTHING', async () => {
      dispatch.countAudience.mockResolvedValue(31204);

      const res = await service.send(req({ audience: 'all' }), ADMIN);

      // The blast is deferred — nothing is enqueued and no dispatch audit is written.
      expect(dispatch.enqueueBroadcast).not.toHaveBeenCalled();

      expect(approvals.create).toHaveBeenCalledTimes(1);
      const arg = approvals.create.mock.calls[0][0];
      const actor = approvals.create.mock.calls[0][1];
      expect(arg.kind).toBe('notification_broadcast');
      expect(actor).toBe(ADMIN);
      // The payload carries exactly what the applier re-validates + re-enqueues.
      expect(arg.payload).toMatchObject({
        audience: 'all',
        templateKey: 'promo_ticketing',
      });

      expect(res).toEqual({
        outcome: 'queued_for_approval',
        recipientCount: 31204,
        changeRequestId: CR_ID,
      });
    });

    it('treats a count exactly at the threshold as large', async () => {
      dispatch.countAudience.mockResolvedValue(10_000);

      const res = await service.send(req({ audience: 'verified' }), ADMIN);

      expect(res.outcome).toBe('queued_for_approval');
      expect(approvals.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('threshold sourcing', () => {
    it('falls back to the default threshold when config returns undefined', async () => {
      config.get.mockReturnValue(undefined);
      dispatch.countAudience.mockResolvedValue(9999);
      dispatch.enqueueBroadcast.mockResolvedValue({
        recipientCount: 9999,
        enqueuedCount: 9999,
      });

      // 9999 is below the default 10_000 → dispatched directly.
      const res = await service.send(req(), ADMIN);
      expect(res.outcome).toBe('dispatched');
    });

    it('honors a DB-admin override of the threshold', async () => {
      config.get.mockReturnValue(1000);
      dispatch.countAudience.mockResolvedValue(2140);

      const res = await service.send(req(), ADMIN);
      // 2140 >= 1000 → deferred to approval under the override.
      expect(res.outcome).toBe('queued_for_approval');
    });
  });
});
