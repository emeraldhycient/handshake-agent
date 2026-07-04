import { Test, type TestingModule } from '@nestjs/testing';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminResendVerificationService } from './admin-resend-verification.service';
import {
  VERIFICATION_OUTBOX_REPOSITORY,
  type IVerificationOutboxRepository,
} from './ports/verification-outbox.repository.port';

/**
 * ADM Phase 9 — the admin RESEND-VERIFICATION service. It re-enqueues an
 * onboarding/verification nudge to a user via the notifications OUTBOX (the
 * dispatch worker later sends). It moves NO money (§3.1), holds no Prisma import
 * (§3.2 — reaches the DB only through injected ports), re-checks the target user
 * SERVER-SIDE (§3.3, 404 on an unknown id), and immutably audits every enqueue.
 */
describe('AdminResendVerificationService', () => {
  const USER_ID = 'usr-1';
  const ADMIN_ID = 'adm-9';

  let service: AdminResendVerificationService;
  let identity: jest.Mocked<Pick<IIdentityRepository, 'loadUser'>>;
  let outbox: jest.Mocked<IVerificationOutboxRepository>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;

  beforeEach(async () => {
    identity = { loadUser: jest.fn() };
    outbox = { enqueueVerification: jest.fn() };
    audit = { record: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AdminResendVerificationService,
        { provide: IDENTITY_REPOSITORY, useValue: identity },
        { provide: VERIFICATION_OUTBOX_REPOSITORY, useValue: outbox },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(AdminResendVerificationService);
    identity.loadUser.mockResolvedValue({ id: USER_ID } as never);
    outbox.enqueueVerification.mockResolvedValue({ notificationId: 'ntf-1' });
  });

  it('404s when the target user does not exist (no enqueue, no audit)', async () => {
    identity.loadUser.mockResolvedValue(null);

    await expect(
      service.resend(USER_ID, ADMIN_ID, 'never arrived'),
    ).rejects.toBeInstanceOf(AdminNotFoundError);

    expect(outbox.enqueueVerification).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('enqueues a verification notification for the target user (path id, not body)', async () => {
    await service.resend(USER_ID, ADMIN_ID, undefined);

    expect(outbox.enqueueVerification).toHaveBeenCalledTimes(1);
    const arg = outbox.enqueueVerification.mock.calls[0][0];
    expect(arg.userId).toBe(USER_ID);
    // A stable eventRef anchors the outbox unique so a same-request replay is a no-op.
    expect(typeof arg.eventRef).toBe('string');
    expect(arg.eventRef.length).toBeGreaterThan(0);
    expect(typeof arg.templateKey).toBe('string');
    expect(arg.templateKey.length).toBeGreaterThan(0);
  });

  it('audits the resend against the user, carrying the optional reason', async () => {
    await service.resend(
      USER_ID,
      ADMIN_ID,
      'user says the email never arrived',
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0];
    expect(entry.actorAdminId).toBe(ADMIN_ID);
    expect(entry.subject).toBe(`User:${USER_ID}`);
    expect(entry.action).toBe('admin_update');
    expect(entry.details).toMatchObject({
      reason: 'user says the email never arrived',
    });
  });

  it('audits with a null reason when the operator omits one (courtesy resend)', async () => {
    await service.resend(USER_ID, ADMIN_ID, undefined);

    const entry = audit.record.mock.calls[0][0];
    expect(entry.details).toMatchObject({ reason: null });
  });

  it('enqueues BEFORE it audits (never audit a send that did not happen)', async () => {
    const order: string[] = [];
    outbox.enqueueVerification.mockImplementation(() => {
      order.push('enqueue');
      return Promise.resolve({ notificationId: 'ntf-1' });
    });
    audit.record.mockImplementation(() => {
      order.push('audit');
      return Promise.resolve();
    });

    await service.resend(USER_ID, ADMIN_ID, undefined);

    expect(order).toEqual(['enqueue', 'audit']);
  });
});
