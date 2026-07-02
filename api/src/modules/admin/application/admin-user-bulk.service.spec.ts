import { AdminUserBulkService } from './admin-user-bulk.service';
import type { IUserBulkRepository } from './ports/user-bulk.repository.port';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AdminBulkConfirmationRequiredError } from '../domain/admin-errors';
import type {
  ApplyUserTagsRequest,
  BulkMessageRequest,
} from '@handshake-agent/contracts';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222222';
const U2 = '33333333-3333-4333-8333-333333333333';

function tagReq(
  over: Partial<ApplyUserTagsRequest> = {},
): ApplyUserTagsRequest {
  return { userIds: [U1, U2], tag: 'vip', reason: 'review', ...over };
}

function msgReq(over: Partial<BulkMessageRequest> = {}): BulkMessageRequest {
  return {
    userIds: [U1, U2],
    eventType: 'balance_update',
    templateKey: 'ops.balance_notice',
    variables: {},
    reason: 'nudge',
    confirmLargeSet: false,
    ...over,
  };
}

describe('AdminUserBulkService', () => {
  let repo: jest.Mocked<IUserBulkRepository>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let config: jest.Mocked<Pick<EffectiveConfigService, 'get'>>;
  let service: AdminUserBulkService;

  beforeEach(() => {
    repo = {
      filterExistingUserIds: jest.fn().mockResolvedValue([U1, U2]),
      applyTag: jest.fn().mockResolvedValue({ created: 2 }),
      enqueueMessage: jest.fn().mockResolvedValue({ enqueued: 2 }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    // Large-set threshold from DB-admin layer; default (unset) returns undefined.
    config = { get: jest.fn().mockReturnValue(undefined) };
    service = new AdminUserBulkService(
      repo,
      audit as unknown as AuditService,
      config as unknown as EffectiveConfigService,
    );
  });

  describe('applyTags', () => {
    it('applies the tag to the existing selection and audits', async () => {
      const res = await service.applyTags(tagReq(), ADMIN);

      expect(repo.filterExistingUserIds).toHaveBeenCalledWith([U1, U2]);
      expect(repo.applyTag).toHaveBeenCalledWith([U1, U2], 'vip', ADMIN);
      expect(res).toEqual({ tag: 'vip', requested: 2, applied: 2 });
      expect(audit.record).toHaveBeenCalledTimes(1);
      const rec = audit.record.mock.calls[0][0];
      expect(rec.actorAdminId).toBe(ADMIN);
      expect(rec.action).toBe('admin_update');
    });

    it('lower-cases the tag before persisting (stable idempotency key)', async () => {
      await service.applyTags(tagReq({ tag: 'VIP' }), ADMIN);
      expect(repo.applyTag).toHaveBeenCalledWith([U1, U2], 'vip', ADMIN);
    });

    it('narrows to only existing users (drops a stale id from the selection)', async () => {
      repo.filterExistingUserIds.mockResolvedValue([U1]);
      const res = await service.applyTags(tagReq(), ADMIN);
      expect(repo.applyTag).toHaveBeenCalledWith([U1], 'vip', ADMIN);
      expect(res.requested).toBe(1);
    });

    it('is idempotent: applied reflects only NEW rows, never a raw count', async () => {
      repo.applyTag.mockResolvedValue({ created: 0 });
      const res = await service.applyTags(tagReq(), ADMIN);
      expect(res.applied).toBe(0);
    });

    it('never enqueues a message from the tag path (no money/comms coupling)', async () => {
      await service.applyTags(tagReq(), ADMIN);
      expect(repo.enqueueMessage).not.toHaveBeenCalled();
    });

    it('no-ops (no write, no audit) when no selected user exists', async () => {
      repo.filterExistingUserIds.mockResolvedValue([]);
      const res = await service.applyTags(tagReq(), ADMIN);
      expect(repo.applyTag).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(res).toEqual({ tag: 'vip', requested: 0, applied: 0 });
    });
  });

  describe('queueMessage', () => {
    it('enqueues onto the outbox with a shared broadcastRef and audits', async () => {
      const res = await service.queueMessage(msgReq(), ADMIN);

      expect(repo.enqueueMessage).toHaveBeenCalledTimes(1);
      const arg = repo.enqueueMessage.mock.calls[0][0];
      expect(arg.userIds).toEqual([U1, U2]);
      expect(arg.eventType).toBe('balance_update');
      expect(arg.templateKey).toBe('ops.balance_notice');
      expect(typeof arg.broadcastRef).toBe('string');
      expect(arg.broadcastRef.length).toBeGreaterThan(0);
      expect(res.queued).toBe(2);
      expect(res.requested).toBe(2);
      expect(res.broadcastRef).toBe(arg.broadcastRef);
      expect(audit.record).toHaveBeenCalledTimes(1);
    });

    it('freezes the operator reason into the outbox render vars', async () => {
      await service.queueMessage(
        msgReq({ variables: { balance: '5' } }),
        ADMIN,
      );
      const arg = repo.enqueueMessage.mock.calls[0][0];
      expect(arg.templateVars).toMatchObject({ balance: '5' });
    });

    it('narrows to existing users before enqueue', async () => {
      repo.filterExistingUserIds.mockResolvedValue([U1]);
      await service.queueMessage(msgReq(), ADMIN);
      expect(repo.enqueueMessage.mock.calls[0][0].userIds).toEqual([U1]);
    });

    it('no-ops when no selected user exists', async () => {
      repo.filterExistingUserIds.mockResolvedValue([]);
      const res = await service.queueMessage(msgReq(), ADMIN);
      expect(repo.enqueueMessage).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(res.queued).toBe(0);
    });

    it('requires explicit confirmation over the large-set threshold (server-side)', async () => {
      config.get.mockReturnValue(1); // threshold = 1
      repo.filterExistingUserIds.mockResolvedValue([U1, U2]); // 2 > 1
      await expect(
        service.queueMessage(msgReq({ confirmLargeSet: false }), ADMIN),
      ).rejects.toBeInstanceOf(AdminBulkConfirmationRequiredError);
      // Nothing is enqueued when the gate blocks (§3.1/§3.3).
      expect(repo.enqueueMessage).not.toHaveBeenCalled();
    });

    it('proceeds over the threshold once explicitly confirmed', async () => {
      config.get.mockReturnValue(1);
      repo.filterExistingUserIds.mockResolvedValue([U1, U2]);
      const res = await service.queueMessage(
        msgReq({ confirmLargeSet: true }),
        ADMIN,
      );
      expect(repo.enqueueMessage).toHaveBeenCalledTimes(1);
      expect(res.queued).toBe(2);
    });

    it('does not gate a selection below the threshold', async () => {
      config.get.mockReturnValue(3); // threshold = 3, selection = 2 (below)
      const res = await service.queueMessage(
        msgReq({ confirmLargeSet: false }),
        ADMIN,
      );
      expect(repo.enqueueMessage).toHaveBeenCalledTimes(1);
      expect(res.queued).toBe(2);
    });
  });
});
