import {
  AdminNotFoundError,
  AdminUnsupportedCurrencyError,
} from '../domain/admin-errors';
import { AdminUserSecurityService } from './admin-user-security.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { AuditListResult } from '../../../core/audit/application/ports/audit-log.repository.port';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { LimitsConfig } from '../../../core/config/configuration';
import type {
  IIdentityRepository,
  UserRecord,
} from '../../identity/application/ports/identity.repository.port';
import type {
  DailyUsage,
  IVelocityRepository,
} from '../../identity/application/ports/velocity.repository.port';
import type {
  IUserSessionReadRepository,
  UserSessionRecord,
} from './ports/user-session-read.repository.port';

const NOW = new Date('2026-06-30T12:00:00.000Z');
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';

// A rolling-24h window starts one day before `NOW`.
const WINDOW_START = new Date('2026-06-29T12:00:00.000Z');

const LIMITS: LimitsConfig = {
  NGN: {
    tier_1: { perTxFiatMax: 100000, dailyFiatMax: 500000, dailyTxCountMax: 10 },
    tier_2: {
      perTxFiatMax: 5000000,
      dailyFiatMax: 50000000,
      dailyTxCountMax: 50,
    },
    tier_3: {
      perTxFiatMax: 20000000,
      dailyFiatMax: 200000000,
      dailyTxCountMax: 200,
    },
  },
};

function makeUser(over?: Partial<UserRecord>): UserRecord {
  return {
    id: USER_ID,
    status: 'active',
    kycStatus: 'verified',
    kycTier: 'tier_2',
    simSwapDetectedAt: null,
    tierChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    pinnedDeviceId: null,
    ...over,
  };
}

function makeSession(over?: Partial<UserSessionRecord>): UserSessionRecord {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    channel: 'web',
    deviceId: '33333333-3333-3333-3333-333333333333',
    userAgent: 'Mozilla/5.0',
    ipAddress: '102.89.34.19',
    isActive: true,
    stepUpCompletedAt: null,
    issuedAt: new Date('2026-06-30T11:00:00.000Z'),
    expiresAt: new Date('2026-07-01T11:00:00.000Z'),
    lastActivityAt: new Date('2026-06-30T11:58:00.000Z'),
    revokedAt: null,
    ...over,
  };
}

interface Mocks {
  sessions: jest.Mocked<IUserSessionReadRepository>;
  velocity: jest.Mocked<IVelocityRepository>;
  identity: jest.Mocked<Pick<IIdentityRepository, 'loadUser'>>;
  config: jest.Mocked<Pick<EffectiveConfigService, 'get'>>;
  registry: jest.Mocked<Pick<AssetRegistry, 'defaultFiat' | 'supportedFiats'>>;
  audit: jest.Mocked<Pick<AuditService, 'list' | 'record'>>;
}

function makeMocks(): { service: AdminUserSecurityService; m: Mocks } {
  const sessions = {
    listForUser: jest.fn(),
    revokeSession: jest.fn(),
    revokeAllForUser: jest.fn(),
  } as unknown as jest.Mocked<IUserSessionReadRepository>;

  const velocity = {
    getDailyUsage: jest.fn(),
  } as unknown as jest.Mocked<IVelocityRepository>;

  const identity = {
    loadUser: jest.fn(),
  } as unknown as jest.Mocked<Pick<IIdentityRepository, 'loadUser'>>;

  const config = {
    get: jest.fn().mockReturnValue(LIMITS),
  } as unknown as jest.Mocked<Pick<EffectiveConfigService, 'get'>>;

  const registry = {
    defaultFiat: jest.fn().mockReturnValue('NGN'),
    supportedFiats: jest.fn().mockReturnValue(['NGN', 'GHS', 'XOF']),
  } as unknown as jest.Mocked<
    Pick<AssetRegistry, 'defaultFiat' | 'supportedFiats'>
  >;

  const audit = {
    list: jest.fn(),
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<AuditService, 'list' | 'record'>>;

  const clock = { now: () => NOW };

  const service = new AdminUserSecurityService(
    sessions,
    velocity,
    identity as unknown as IIdentityRepository,
    config as unknown as EffectiveConfigService,
    registry as unknown as AssetRegistry,
    audit as unknown as AuditService,
    clock,
  );

  return {
    service,
    m: { sessions, velocity, identity, config, registry, audit },
  };
}

// ── listSessions ───────────────────────────────────────────────────────────────

describe('AdminUserSecurityService.listSessions', () => {
  it('throws AdminNotFoundError when the user does not exist', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(null);

    await expect(service.listSessions(USER_ID)).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
    expect(m.sessions.listForUser).not.toHaveBeenCalled();
  });

  it('maps session records to ISO dates and passes token hashes through nowhere', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser());
    m.sessions.listForUser.mockResolvedValue([
      makeSession(),
      makeSession({
        id: '44444444-4444-4444-4444-444444444444',
        deviceId: null,
        userAgent: null,
        ipAddress: null,
        isActive: false,
        stepUpCompletedAt: new Date('2026-06-30T10:00:00.000Z'),
        lastActivityAt: null,
        revokedAt: new Date('2026-06-30T10:30:00.000Z'),
      }),
    ]);

    const out = await service.listSessions(USER_ID);

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: '22222222-2222-2222-2222-222222222222',
      channel: 'web',
      deviceId: '33333333-3333-3333-3333-333333333333',
      userAgent: 'Mozilla/5.0',
      ipAddress: '102.89.34.19',
      isActive: true,
      stepUpCompletedAt: null,
      issuedAt: '2026-06-30T11:00:00.000Z',
      expiresAt: '2026-07-01T11:00:00.000Z',
      lastActivityAt: '2026-06-30T11:58:00.000Z',
      revokedAt: null,
    });
    expect(out[1].deviceId).toBeNull();
    expect(out[1].stepUpCompletedAt).toBe('2026-06-30T10:00:00.000Z');
    expect(out[1].revokedAt).toBe('2026-06-30T10:30:00.000Z');
    // No token-hash field ever appears in the projection.
    expect(JSON.stringify(out)).not.toContain('TokenHash');
  });
});

// ── getLimits ────────────────────────────────────────────────────────────────

describe('AdminUserSecurityService.getLimits', () => {
  it('throws AdminNotFoundError when the user does not exist', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(null);

    await expect(service.getLimits(USER_ID)).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
  });

  it('resolves effective caps for the tier + fiat and the live velocity window', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser({ kycTier: 'tier_2' }));
    const usage: DailyUsage = { fiatTotal: '252551.70', txCount: 6 };
    m.velocity.getDailyUsage.mockResolvedValue(usage);

    const out = await service.getLimits(USER_ID);

    expect(m.velocity.getDailyUsage).toHaveBeenCalledWith(USER_ID, NOW, 'NGN');
    expect(out.effectiveLimits).toEqual({
      tier: 'tier_2',
      fiatCurrency: 'NGN',
      perTxFiatMax: '5000000',
      dailyFiatMax: '50000000',
      dailyTxCountMax: 50,
    });
    expect(out.velocity).toEqual({
      dailyFiatUsed: '252551.70',
      dailyTxCount: 6,
      fiatCurrency: 'NGN',
      windowStart: WINDOW_START.toISOString(),
      windowEnd: NOW.toISOString(),
    });
  });

  it('threads an explicit ?currency= to the velocity read and the effective caps', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser({ kycTier: 'tier_1' }));
    m.config.get.mockReturnValue({
      ...LIMITS,
      GHS: {
        tier_1: { perTxFiatMax: 800, dailyFiatMax: 4000, dailyTxCountMax: 10 },
        tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
        tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      },
    });
    m.velocity.getDailyUsage.mockResolvedValue({
      fiatTotal: '120',
      txCount: 2,
    });

    const out = await service.getLimits(USER_ID, 'GHS');

    expect(m.velocity.getDailyUsage).toHaveBeenCalledWith(USER_ID, NOW, 'GHS');
    expect(out.effectiveLimits?.fiatCurrency).toBe('GHS');
    expect(out.effectiveLimits?.perTxFiatMax).toBe('800');
    expect(out.velocity.fiatCurrency).toBe('GHS');
  });

  it('rejects a currency outside the fiat catalog fail-closed (no velocity read)', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser());

    await expect(service.getLimits(USER_ID, 'ZZZ')).rejects.toBeInstanceOf(
      AdminUnsupportedCurrencyError,
    );
    expect(m.velocity.getDailyUsage).not.toHaveBeenCalled();
  });

  it('accepts a runtime custom fiat (the catalog check uses supportedFiats, not the built-in enum)', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser({ kycTier: 'tier_1' }));
    m.velocity.getDailyUsage.mockResolvedValue({ fiatTotal: '0', txCount: 0 });

    const out = await service.getLimits(USER_ID, 'XOF');

    expect(m.velocity.getDailyUsage).toHaveBeenCalledWith(USER_ID, NOW, 'XOF');
    // No configured limits for XOF -> effectiveLimits null, but the usage window
    // is still reported in the requested currency.
    expect(out.effectiveLimits).toBeNull();
    expect(out.velocity.fiatCurrency).toBe('XOF');
  });

  it('returns null effectiveLimits for an unverified tier but still reports velocity', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser({ kycTier: 'unverified' }));
    m.velocity.getDailyUsage.mockResolvedValue({ fiatTotal: '0', txCount: 0 });

    const out = await service.getLimits(USER_ID);

    expect(out.effectiveLimits).toBeNull();
    expect(out.velocity.dailyTxCount).toBe(0);
  });

  it('returns null effectiveLimits when the fiat has no configured limits', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser({ kycTier: 'tier_1' }));
    m.registry.defaultFiat.mockReturnValue('GHS');
    m.velocity.getDailyUsage.mockResolvedValue({ fiatTotal: '0', txCount: 0 });

    const out = await service.getLimits(USER_ID);

    expect(out.effectiveLimits).toBeNull();
  });
});

// ── listTimeline ─────────────────────────────────────────────────────────────

describe('AdminUserSecurityService.listTimeline', () => {
  it('throws AdminNotFoundError when the user does not exist', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(null);

    await expect(service.listTimeline(USER_ID)).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
    expect(m.audit.list).not.toHaveBeenCalled();
  });

  it('queries the audit log by the user subject and projects id/action/actor/time', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser());
    const result: AuditListResult = {
      items: [
        {
          id: '55555555-5555-5555-5555-555555555555',
          correlationId: 'corr-1',
          actor: `admin:${ADMIN_ID}`,
          actorUserId: null,
          actorAdminId: ADMIN_ID,
          subject: `User:${USER_ID}`,
          action: 'kyc_state_change',
          details: { secret: 'should-not-be-surfaced' },
          before: { tier: 'tier_1' },
          after: { tier: 'tier_2' },
          prevHash: 'p',
          currentHash: 'c',
          createdAt: new Date('2026-06-29T09:00:00.000Z'),
        },
      ],
      nextCursor: null,
    };
    m.audit.list.mockResolvedValue(result);

    const out = await service.listTimeline(USER_ID);

    expect(m.audit.list).toHaveBeenCalledWith({
      subject: `User:${USER_ID}`,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest expect.any(Number) is typed `any`
      limit: expect.any(Number),
    });
    expect(out).toEqual([
      {
        id: '55555555-5555-5555-5555-555555555555',
        action: 'kyc_state_change',
        actor: `admin:${ADMIN_ID}`,
        actorAdminId: ADMIN_ID,
        createdAt: '2026-06-29T09:00:00.000Z',
      },
    ]);
    // Sensitive before/after/details snapshots are NOT surfaced in the timeline.
    expect(JSON.stringify(out)).not.toContain('should-not-be-surfaced');
  });
});

// ── revokeSession ─────────────────────────────────────────────────────────────

const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const REASON = 'compromised device reported by user';

describe('AdminUserSecurityService.revokeSession', () => {
  it('throws AdminNotFoundError when the user does not exist', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(null);

    await expect(
      service.revokeSession(USER_ID, SESSION_ID, REASON, ADMIN_ID),
    ).rejects.toBeInstanceOf(AdminNotFoundError);
    expect(m.sessions.revokeSession).not.toHaveBeenCalled();
    expect(m.audit.record).not.toHaveBeenCalled();
  });

  it('throws AdminNotFoundError when no live session matched (fails closed, no audit)', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser());
    m.sessions.revokeSession.mockResolvedValue(false);

    await expect(
      service.revokeSession(USER_ID, SESSION_ID, REASON, ADMIN_ID),
    ).rejects.toBeInstanceOf(AdminNotFoundError);
    expect(m.sessions.revokeSession).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      NOW,
      REASON,
    );
    // No live session was revoked → nothing to audit.
    expect(m.audit.record).not.toHaveBeenCalled();
  });

  it('revokes the session scoped to the user and records a session_revoke audit', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser());
    m.sessions.revokeSession.mockResolvedValue(true);

    await service.revokeSession(USER_ID, SESSION_ID, REASON, ADMIN_ID);

    // The user id from the path scopes the revoke — never a cross-user revoke.
    expect(m.sessions.revokeSession).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      NOW,
      REASON,
    );
    expect(m.audit.record).toHaveBeenCalledTimes(1);
    const entry = m.audit.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      actorAdminId: ADMIN_ID,
      subject: `User:${USER_ID}`,
      action: 'session_revoke',
      after: { sessionId: SESSION_ID, reason: REASON },
    });
  });
});

// ── revokeAllSessions ─────────────────────────────────────────────────────────

describe('AdminUserSecurityService.revokeAllSessions', () => {
  it('throws AdminNotFoundError when the user does not exist', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(null);

    await expect(
      service.revokeAllSessions(USER_ID, REASON, ADMIN_ID),
    ).rejects.toBeInstanceOf(AdminNotFoundError);
    expect(m.sessions.revokeAllForUser).not.toHaveBeenCalled();
    expect(m.audit.record).not.toHaveBeenCalled();
  });

  it('revokes all live sessions and audits the count (idempotent when zero)', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser());
    m.sessions.revokeAllForUser.mockResolvedValue(0);

    await service.revokeAllSessions(USER_ID, REASON, ADMIN_ID);

    // Force sign-out is idempotent: zero live sessions is a no-op success, and
    // is still audited (the operator's intent to sign the user out is recorded).
    expect(m.sessions.revokeAllForUser).toHaveBeenCalledWith(
      USER_ID,
      NOW,
      REASON,
    );
    expect(m.audit.record).toHaveBeenCalledTimes(1);
    const entry = m.audit.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      actorAdminId: ADMIN_ID,
      subject: `User:${USER_ID}`,
      action: 'session_revoke',
      after: { scope: 'all', revokedCount: 0, reason: REASON },
    });
  });

  it('records the number of sessions revoked when there were live sessions', async () => {
    const { service, m } = makeMocks();
    m.identity.loadUser.mockResolvedValue(makeUser());
    m.sessions.revokeAllForUser.mockResolvedValue(3);

    await service.revokeAllSessions(USER_ID, REASON, ADMIN_ID);

    const entry = m.audit.record.mock.calls[0][0];
    expect(entry.after).toMatchObject({ scope: 'all', revokedCount: 3 });
  });
});
