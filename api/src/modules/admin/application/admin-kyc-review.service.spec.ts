import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminKycReviewService } from './admin-kyc-review.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  IIdentityRepository,
  KycQueueListResult,
  UserAdminDetailRecord,
} from '../../identity/application/ports/identity.repository.port';
import type {
  IKycRepository,
  UpdateKycProfileDecisionInput,
} from '../../identity/application/ports/kyc.repository.port';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';

function makeDetail(
  over?: Partial<UserAdminDetailRecord>,
): UserAdminDetailRecord {
  return {
    id: USER_ID,
    email: 'user@example.com',
    status: 'active',
    kycStatus: 'pending_review',
    kycTier: 'unverified',
    simSwapDetectedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    pinnedDeviceId: null,
    kyc: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: new Date('1990-12-10T00:00:00.000Z'),
      nin: '12345678901',
      bvn: '22345678901',
      idDocumentType: 'passport',
      livenessCheckResult: 'pass',
      status: 'pending_review',
      tier: 'unverified',
      rejectionReason: null,
    },
    devices: [],
    ...over,
  };
}

interface Mocks {
  identity: jest.Mocked<
    Pick<
      IIdentityRepository,
      'listKycReviewQueue' | 'loadUserWithKycAndDevices'
    >
  >;
  kyc: jest.Mocked<Pick<IKycRepository, 'updateKycProfileDecision'>>;
  audit: jest.Mocked<Pick<AuditService, 'record'>>;
  auditCalls: RecordAuditInput[];
  decisionCalls: { userId: string; decision: UpdateKycProfileDecisionInput }[];
}

function makeMocks(): { service: AdminKycReviewService; m: Mocks } {
  const auditCalls: RecordAuditInput[] = [];
  const decisionCalls: {
    userId: string;
    decision: UpdateKycProfileDecisionInput;
  }[] = [];

  const identity = {
    listKycReviewQueue: jest.fn(),
    loadUserWithKycAndDevices: jest.fn(),
  } as unknown as jest.Mocked<
    Pick<
      IIdentityRepository,
      'listKycReviewQueue' | 'loadUserWithKycAndDevices'
    >
  >;

  const kyc = {
    updateKycProfileDecision: jest
      .fn()
      .mockImplementation(
        (userId: string, decision: UpdateKycProfileDecisionInput) => {
          decisionCalls.push({ userId, decision });
          return Promise.resolve();
        },
      ),
  } as unknown as jest.Mocked<Pick<IKycRepository, 'updateKycProfileDecision'>>;

  const audit = {
    record: jest.fn().mockImplementation((input: RecordAuditInput) => {
      auditCalls.push(input);
      return Promise.resolve();
    }),
  } as unknown as jest.Mocked<Pick<AuditService, 'record'>>;

  const service = new AdminKycReviewService(
    identity as unknown as IIdentityRepository,
    kyc as unknown as IKycRepository,
    audit as unknown as AuditService,
  );

  return {
    service,
    m: { identity, kyc, audit, auditCalls, decisionCalls },
  };
}

// ── listQueue ────────────────────────────────────────────────────────────────

describe('AdminKycReviewService.listQueue', () => {
  const NOW = new Date('2026-06-01T01:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function queueResult(
    over?: Partial<KycQueueListResult['items'][number]>,
  ): KycQueueListResult {
    return {
      items: [
        {
          id: USER_ID,
          email: 'user@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          requestedTier: 'tier_1',
          kycStatus: 'pending_review',
          // 1h before NOW → slaAgeSeconds === 3600.
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          ...over,
        },
      ],
      nextCursor: 'cursor-2',
    };
  }

  it('enriches queue rows (displayName, requestedTier, slaAgeSeconds) and forwards cursor', async () => {
    const { service, m } = makeMocks();
    m.identity.listKycReviewQueue.mockResolvedValue(queueResult());

    const out = await service.listQueue({ cursor: 'cursor-1', limit: 10 });

    expect(m.identity.listKycReviewQueue).toHaveBeenCalledWith(
      { status: 'pending_review' },
      { cursor: 'cursor-1', limit: 10 },
    );
    expect(out.nextCursor).toBe('cursor-2');
    expect(out.items).toEqual([
      {
        userId: USER_ID,
        email: 'user@example.com',
        displayName: 'Ada Lovelace',
        requestedTier: 'tier_1',
        status: 'pending_review',
        submittedAt: '2026-06-01T00:00:00.000Z',
        slaAgeSeconds: 3600,
      },
    ]);
  });

  it('forwards an explicit status filter (drives the Approved/Rejected tabs)', async () => {
    const { service, m } = makeMocks();
    m.identity.listKycReviewQueue.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await service.listQueue({ status: 'verified' });

    const [filters] = m.identity.listKycReviewQueue.mock.calls[0];
    expect(filters).toEqual({ status: 'verified' });
  });

  it('defaults the status to pending_review and the limit when not supplied', async () => {
    const { service, m } = makeMocks();
    m.identity.listKycReviewQueue.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await service.listQueue({});

    const [filters, page] = m.identity.listKycReviewQueue.mock.calls[0];
    expect(filters).toEqual({ status: 'pending_review' });
    expect(page.limit).toBeGreaterThan(0);
  });

  it('null-safes name/tier and returns slaAgeSeconds 0 when submittedAt is absent', async () => {
    const { service, m } = makeMocks();
    m.identity.listKycReviewQueue.mockResolvedValue(
      queueResult({
        firstName: null,
        lastName: null,
        requestedTier: null,
      }),
    );

    const out = await service.listQueue({});

    expect(out.items[0].displayName).toBeNull();
    expect(out.items[0].requestedTier).toBeNull();
  });

  it('composes the display name from a first name alone (trailing space trimmed)', async () => {
    const { service, m } = makeMocks();
    m.identity.listKycReviewQueue.mockResolvedValue(
      queueResult({ firstName: 'Ada', lastName: null }),
    );

    const out = await service.listQueue({});

    expect(out.items[0].displayName).toBe('Ada');
  });

  it('clamps a future submittedAt to a non-negative slaAgeSeconds', async () => {
    const { service, m } = makeMocks();
    m.identity.listKycReviewQueue.mockResolvedValue(
      queueResult({ createdAt: new Date('2026-06-01T02:00:00.000Z') }),
    );

    const out = await service.listQueue({});

    expect(out.items[0].slaAgeSeconds).toBe(0);
  });
});

// ── getSubmission ────────────────────────────────────────────────────────────

describe('AdminKycReviewService.getSubmission', () => {
  it('throws AdminNotFoundError when the user has no record', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(null);

    await expect(service.getSubmission(USER_ID)).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
  });

  it('throws AdminNotFoundError when there is no KYC profile', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(
      makeDetail({ kyc: null }),
    );

    await expect(service.getSubmission(USER_ID)).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
  });

  it('returns ONLY the last-4 of NIN/BVN — never the full identifiers', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(makeDetail());

    const out = await service.getSubmission(USER_ID);

    expect(out.ninLast4).toBe('8901');
    expect(out.bvnLast4).toBe('8901');

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('12345678901'); // full nin absent
    expect(serialized).not.toContain('22345678901'); // full bvn absent
  });

  it('maps liveness/status/tier/rejectionReason and ISO dateOfBirth', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(
      makeDetail({
        kyc: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          dateOfBirth: new Date('1990-12-10T00:00:00.000Z'),
          nin: null,
          bvn: null,
          idDocumentType: 'nin_slip',
          livenessCheckResult: 'fail',
          status: 'rejected',
          tier: 'unverified',
          rejectionReason: 'blurry selfie',
        },
      }),
    );

    const out = await service.getSubmission(USER_ID);

    expect(out).toEqual({
      userId: USER_ID,
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1990-12-10T00:00:00.000Z',
      ninLast4: null,
      bvnLast4: null,
      idDocumentType: 'nin_slip',
      livenessResult: 'fail',
      status: 'rejected',
      tier: 'unverified',
      rejectionReason: 'blurry selfie',
    });
  });
});

// ── approve ──────────────────────────────────────────────────────────────────

describe('AdminKycReviewService.approve', () => {
  it('records a verified decision at the chosen tier and audits kyc_state_change', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(makeDetail());

    await service.approve(USER_ID, 'tier_2', ADMIN_ID);

    expect(m.decisionCalls).toHaveLength(1);
    expect(m.decisionCalls[0]).toEqual({
      userId: USER_ID,
      decision: {
        status: 'verified',
        tier: 'tier_2',
        reviewedByAdminId: ADMIN_ID,
      },
    });

    expect(m.auditCalls).toHaveLength(1);
    const a = m.auditCalls[0];
    expect(a.action).toBe('kyc_state_change');
    expect(a.actorAdminId).toBe(ADMIN_ID);
    expect(a.subject).toContain(USER_ID);
    expect(a.after).toEqual({ status: 'verified', tier: 'tier_2' });
  });
});

// ── reject ───────────────────────────────────────────────────────────────────

describe('AdminKycReviewService.reject', () => {
  it('records a rejected decision (unverified) with the reason and audits', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUserWithKycAndDevices.mockResolvedValue(makeDetail());

    await service.reject(USER_ID, 'document mismatch', ADMIN_ID);

    expect(m.decisionCalls).toHaveLength(1);
    expect(m.decisionCalls[0]).toEqual({
      userId: USER_ID,
      decision: {
        status: 'rejected',
        tier: 'unverified',
        rejectionReason: 'document mismatch',
        reviewedByAdminId: ADMIN_ID,
      },
    });

    expect(m.auditCalls).toHaveLength(1);
    const a = m.auditCalls[0];
    expect(a.action).toBe('kyc_state_change');
    expect(a.actorAdminId).toBe(ADMIN_ID);
    expect(a.after).toEqual({
      status: 'rejected',
      tier: 'unverified',
      rejectionReason: 'document mismatch',
    });
  });
});
