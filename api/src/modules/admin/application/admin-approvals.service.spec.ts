import { AdminApprovalsService } from './admin-approvals.service';
import type { IChangeRequestRepository } from './ports/change-request.repository.port';
import type { ChangeRequestRecord } from './ports/change-request.repository.port';
import type { IBroadcastDispatchRepository } from './ports/broadcast-dispatch.repository.port';
import type { AdminSettingsService } from './admin-settings.service';
import type { AdminTxnTriageService } from './admin-txn-triage.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  ChangeRequestNotApplicableError,
  ChangeRequestNotPendingError,
  SelfApprovalForbiddenError,
} from '../domain/approvals-errors';

const MAKER = '11111111-1111-4111-8111-111111111111';
const CHECKER = '22222222-2222-4222-8222-222222222222';
const REQ_ID = '33333333-3333-4333-8333-333333333333';
const TXN_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-07-01T12:00:00.000Z');

function pendingRecord(
  over: Partial<ChangeRequestRecord> = {},
): ChangeRequestRecord {
  return {
    id: REQ_ID,
    kind: 'pricing_change',
    resource: 'pricing.assets.USDT.baseRates.NGN',
    payload: { key: 'pricing.assets.USDT.baseRates.NGN', value: 1650 },
    status: 'pending',
    reason: 'Align with market',
    requestedByAdminId: MAKER,
    decidedByAdminId: null,
    decisionReason: null,
    decidedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  };
}

describe('AdminApprovalsService', () => {
  let repo: jest.Mocked<IChangeRequestRepository>;
  let settings: jest.Mocked<Pick<AdminSettingsService, 'update'>>;
  let triage: jest.Mocked<Pick<AdminTxnTriageService, 'markFailedAndRefund'>>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let broadcast: jest.Mocked<IBroadcastDispatchRepository>;
  let manualCredit: { creditUser: jest.Mock };
  let service: AdminApprovalsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      listPending: jest.fn(),
      listByRequester: jest.fn(),
      decideIfPending: jest.fn(),
      resolveEmails: jest.fn().mockResolvedValue(new Map()),
    };
    settings = { update: jest.fn().mockResolvedValue(undefined) };
    triage = {
      markFailedAndRefund: jest.fn().mockResolvedValue({
        transactionId: TXN_ID,
        status: 'failed',
        refunded: true,
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    broadcast = {
      countAudience: jest.fn(),
      enqueueBroadcast: jest
        .fn()
        .mockResolvedValue({ recipientCount: 31204, enqueuedCount: 31204 }),
    };
    // The manual_credit applier — a bare stub of `creditUser` the manual_credit
    // applier tests assert against (routes the engine-brokered credit).
    manualCredit = { creditUser: jest.fn().mockResolvedValue(undefined) };
    service = new AdminApprovalsService(
      repo,
      settings as unknown as AdminSettingsService,
      triage as unknown as AdminTxnTriageService,
      audit as unknown as AuditService,
      { now: () => NOW },
      broadcast,
      manualCredit as unknown as ConstructorParameters<
        typeof AdminApprovalsService
      >[6],
    );
  });

  describe('create', () => {
    it('persists a pending request and audits it as admin_update', async () => {
      const created = pendingRecord();
      repo.create.mockResolvedValue(created);

      const view = await service.create(
        {
          kind: 'pricing_change',
          resource: created.resource,
          payload: created.payload,
          reason: created.reason,
        },
        MAKER,
      );

      expect(repo.create).toHaveBeenCalledWith({
        kind: 'pricing_change',
        resource: created.resource,
        payload: created.payload,
        reason: created.reason,
        requestedByAdminId: MAKER,
      });
      expect(view.status).toBe('pending');
      // Creating a request NEVER applies the change.
      expect(settings.update).not.toHaveBeenCalled();
      expect(triage.markFailedAndRefund).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: MAKER,
          subject: `ChangeRequest:${REQ_ID}`,
          action: 'admin_update',
        }),
      );
    });
  });

  describe('approve', () => {
    it('rejects self-approval BEFORE applying or deciding (four-eyes)', async () => {
      repo.findById.mockResolvedValue(pendingRecord());

      await expect(service.approve(REQ_ID, MAKER)).rejects.toBeInstanceOf(
        SelfApprovalForbiddenError,
      );
      expect(settings.update).not.toHaveBeenCalled();
      expect(repo.decideIfPending).not.toHaveBeenCalled();
    });

    it('throws not-found for an unknown request', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });

    it('rejects a decision on an already-decided request', async () => {
      repo.findById.mockResolvedValue(pendingRecord({ status: 'approved' }));
      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        ChangeRequestNotPendingError,
      );
    });

    it('applies a pricing_change via AdminSettingsService.update (config-brokered)', async () => {
      repo.findById.mockResolvedValue(pendingRecord());
      repo.decideIfPending.mockResolvedValue(
        pendingRecord({
          status: 'approved',
          decidedByAdminId: CHECKER,
          decidedAt: NOW,
        }),
      );

      const view = await service.approve(REQ_ID, CHECKER);

      expect(settings.update).toHaveBeenCalledWith(
        'pricing.assets.USDT.baseRates.NGN',
        1650,
        'global',
        null,
        CHECKER,
      );
      // The decision is recorded ONLY after the apply succeeds, and is atomic-guarded.
      expect(repo.decideIfPending).toHaveBeenCalledWith(
        expect.objectContaining({
          id: REQ_ID,
          status: 'approved',
          decidedByAdminId: CHECKER,
          decidedAt: NOW,
        }),
      );
      expect(view.status).toBe('approved');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: CHECKER,
          subject: `ChangeRequest:${REQ_ID}`,
          action: 'admin_override',
        }),
      );
    });

    it('applies a tier_override via AdminSettingsService with tier scope', async () => {
      repo.findById.mockResolvedValue(
        pendingRecord({
          kind: 'tier_override',
          resource: 'limits.tier_1.daily',
          payload: {
            key: 'limits.tier_1.daily',
            value: 500000,
            scope: 'tier',
            scopeValue: 'tier_1',
          },
        }),
      );
      repo.decideIfPending.mockResolvedValue(
        pendingRecord({
          status: 'approved',
          decidedByAdminId: CHECKER,
          decidedAt: NOW,
        }),
      );

      await service.approve(REQ_ID, CHECKER);

      expect(settings.update).toHaveBeenCalledWith(
        'limits.tier_1.daily',
        500000,
        'tier',
        'tier_1',
        CHECKER,
      );
    });

    it('applies a refund via the engine-brokered AdminTxnTriageService, NEVER a raw ledger write', async () => {
      repo.findById.mockResolvedValue(
        pendingRecord({
          kind: 'refund',
          resource: `Transaction:${TXN_ID}`,
          payload: { transactionId: TXN_ID },
        }),
      );
      repo.decideIfPending.mockResolvedValue(
        pendingRecord({
          kind: 'refund',
          status: 'approved',
          decidedByAdminId: CHECKER,
          decidedAt: NOW,
        }),
      );

      await service.approve(REQ_ID, CHECKER);

      // The ONLY money path is the engine's atomic refund method.
      expect(triage.markFailedAndRefund).toHaveBeenCalledWith(
        TXN_ID,
        expect.any(String),
        CHECKER,
      );
      expect(settings.update).not.toHaveBeenCalled();
    });

    it('does NOT record the decision if the apply throws (no half-applied state)', async () => {
      repo.findById.mockResolvedValue(pendingRecord());
      settings.update.mockRejectedValue(new Error('config write failed'));

      await expect(service.approve(REQ_ID, CHECKER)).rejects.toThrow(
        'config write failed',
      );
      expect(repo.decideIfPending).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('fails closed on a malformed payload (missing key) — never guesses', async () => {
      repo.findById.mockResolvedValue(
        pendingRecord({ payload: { value: 1650 } }),
      );
      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        ChangeRequestNotApplicableError,
      );
      expect(settings.update).not.toHaveBeenCalled();
    });

    it('returns idempotently if the decision race lost (decideIfPending → null)', async () => {
      repo.findById.mockResolvedValue(pendingRecord());
      repo.decideIfPending.mockResolvedValue(null);

      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        ChangeRequestNotPendingError,
      );
    });
  });

  describe('approve — manual_credit applier (§3.1)', () => {
    const CREDIT_USER = '99999999-9999-9999-9999-999999999999';

    function manualCreditRecord(
      payload: Record<string, unknown>,
    ): ChangeRequestRecord {
      return pendingRecord({
        kind: 'manual_credit',
        resource: `User:${CREDIT_USER}`,
        payload,
      });
    }

    it('routes the credit through the engine-brokered service, idempotency-keyed by the request id', async () => {
      repo.findById.mockResolvedValue(
        manualCreditRecord({
          userId: CREDIT_USER,
          asset: 'USDT',
          amount: '25.5',
        }),
      );
      repo.decideIfPending.mockResolvedValue(
        pendingRecord({
          kind: 'manual_credit',
          status: 'approved',
          decidedByAdminId: CHECKER,
          decidedAt: NOW,
        }),
      );

      await service.approve(REQ_ID, CHECKER);

      // The ONLY money path is the engine-brokered credit service.
      expect(manualCredit.creditUser).toHaveBeenCalledWith({
        userId: CREDIT_USER,
        asset: 'USDT',
        amount: '25.5',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest expect.any(String) is typed `any`
        reason: expect.any(String),
        idempotencyKey: REQ_ID,
        approvedByAdminId: CHECKER,
      });
      // No raw config / refund side-channel.
      expect(settings.update).not.toHaveBeenCalled();
      expect(triage.markFailedAndRefund).not.toHaveBeenCalled();
    });

    it('fails closed on a malformed payload (missing userId) — never credits', async () => {
      repo.findById.mockResolvedValue(
        manualCreditRecord({ asset: 'USDT', amount: '25.5' }),
      );

      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        ChangeRequestNotApplicableError,
      );
      expect(manualCredit.creditUser).not.toHaveBeenCalled();
      expect(repo.decideIfPending).not.toHaveBeenCalled();
    });

    it('fails closed on a non-positive amount (never a no-op / sign-flipped credit)', async () => {
      repo.findById.mockResolvedValue(
        manualCreditRecord({ userId: CREDIT_USER, asset: 'USDT', amount: '0' }),
      );

      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        ChangeRequestNotApplicableError,
      );
      expect(manualCredit.creditUser).not.toHaveBeenCalled();
    });
  });

  describe('approve — notification_broadcast applier (§3.5)', () => {
    function broadcastRecord(
      payload: Record<string, unknown>,
    ): ChangeRequestRecord {
      return pendingRecord({
        kind: 'notification_broadcast',
        resource: 'notification.broadcast.all',
        payload,
      });
    }

    it('re-runs the outbox enqueue (never a raw send) anchored on the request id', async () => {
      const record = broadcastRecord({
        audience: 'all',
        templateKey: 'promo_ticketing',
        schedule: { kind: 'now' },
      });
      repo.findById.mockResolvedValue(record);
      repo.decideIfPending.mockResolvedValue({ ...record, status: 'approved' });

      await service.approve(REQ_ID, CHECKER);

      expect(broadcast.enqueueBroadcast).toHaveBeenCalledTimes(1);
      const arg = broadcast.enqueueBroadcast.mock.calls[0][0];
      expect(arg.broadcastId).toBe(REQ_ID); // idempotency anchor
      expect(arg.audience).toBe('all');
      expect(arg.templateKey).toBe('promo_ticketing');
      expect(arg.sendAt).toBeNull();
      // The decision is only recorded after the apply succeeds.
      expect(repo.decideIfPending).toHaveBeenCalledTimes(1);
    });

    it('passes a scheduled sendAt through to the enqueue', async () => {
      const sendAt = '2026-07-02T09:00:00.000Z';
      const record = broadcastRecord({
        audience: 'verified',
        templateKey: 'kyc_reminder',
        schedule: { kind: 'scheduled', sendAt },
      });
      repo.findById.mockResolvedValue(record);
      repo.decideIfPending.mockResolvedValue({ ...record, status: 'approved' });

      await service.approve(REQ_ID, CHECKER);

      expect(broadcast.enqueueBroadcast.mock.calls[0][0].sendAt).toBe(sendAt);
    });

    it('fails closed (does not enqueue or decide) on a malformed payload', async () => {
      const record = broadcastRecord({ templateKey: 'promo_ticketing' }); // no audience
      repo.findById.mockResolvedValue(record);

      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        ChangeRequestNotApplicableError,
      );
      expect(broadcast.enqueueBroadcast).not.toHaveBeenCalled();
      expect(repo.decideIfPending).not.toHaveBeenCalled();
    });

    it('rejects an unknown audience cohort (fail closed)', async () => {
      const record = broadcastRecord({
        audience: 'nobody',
        templateKey: 'promo_ticketing',
      });
      repo.findById.mockResolvedValue(record);

      await expect(service.approve(REQ_ID, CHECKER)).rejects.toBeInstanceOf(
        ChangeRequestNotApplicableError,
      );
      expect(broadcast.enqueueBroadcast).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects self-rejection (four-eyes)', async () => {
      repo.findById.mockResolvedValue(pendingRecord());
      await expect(
        service.reject(REQ_ID, MAKER, 'stale'),
      ).rejects.toBeInstanceOf(SelfApprovalForbiddenError);
    });

    it('records a rejection with reason WITHOUT applying anything', async () => {
      repo.findById.mockResolvedValue(pendingRecord());
      repo.decideIfPending.mockResolvedValue(
        pendingRecord({
          status: 'rejected',
          decidedByAdminId: CHECKER,
          decisionReason: 'Rate is stale',
          decidedAt: NOW,
        }),
      );

      const view = await service.reject(REQ_ID, CHECKER, 'Rate is stale');

      expect(settings.update).not.toHaveBeenCalled();
      expect(repo.decideIfPending).toHaveBeenCalledWith(
        expect.objectContaining({
          id: REQ_ID,
          status: 'rejected',
          decidedByAdminId: CHECKER,
          decisionReason: 'Rate is stale',
        }),
      );
      expect(view.status).toBe('rejected');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin_update' }),
      );
    });
  });

  describe('inbox', () => {
    it('splits lanes: awaitingMe excludes my own pending; myRequests is mine', async () => {
      const mine = pendingRecord({ id: 'a', requestedByAdminId: CHECKER });
      const theirs = pendingRecord({ id: 'b', requestedByAdminId: MAKER });
      repo.listPending.mockResolvedValue([mine, theirs]);
      repo.listByRequester.mockResolvedValue([mine]);

      const inbox = await service.inbox(CHECKER);

      expect(inbox.awaitingMe.map((r) => r.id)).toEqual(['b']);
      expect(inbox.myRequests.map((r) => r.id)).toEqual(['a']);
      expect(inbox.counts).toEqual({
        awaitingMe: 1,
        myRequests: 1,
        myPending: 1,
      });
    });
  });
});
