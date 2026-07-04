import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminEndUserLimitsResponse,
  AdminEndUserSession,
  AdminEndUserTimelineEntry,
} from '@handshake-agent/contracts';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  FiatLimits,
  LimitsConfig,
  TierLimits,
} from '../../../core/config/configuration';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import {
  VELOCITY_REPOSITORY,
  type IVelocityRepository,
} from '../../identity/application/ports/velocity.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  USER_SESSION_READ_REPOSITORY,
  type IUserSessionReadRepository,
  type UserSessionRecord,
} from './ports/user-session-read.repository.port';

/** How many of the user's most-recent sessions to surface on the Security tab. */
const SESSIONS_LIMIT = 20;

/** How many admin-action timeline entries to surface on the Profile tab. */
const TIMELINE_LIMIT = 50;

/** Verified KYC tiers that carry limit entries (`unverified` has none). */
const VERIFIED_TIERS = ['tier_1', 'tier_2', 'tier_3'] as const;
type VerifiedTier = (typeof VERIFIED_TIERS)[number];

/**
 * ADM-02 user-detail security surface for the admin console — the security/limits/
 * timeline reads plus the Phase-9 session-revoke writes. Complements
 * AdminEndUserService (the user aggregate + its audited mutations).
 *
 * Never moves money (§3.1) and surfaces no secrets: sessions carry no token
 * hashes, limits are the effective config caps + live velocity usage, and the
 * timeline is the hash-chained audit log filtered to this user's subject. The
 * revoke writes mark sessions revoked (never delete — retained for audit) and are
 * every one reason→step-up (guarded at the controller) + immutably audited (§3.4).
 */
@Injectable()
export class AdminUserSecurityService {
  constructor(
    @Inject(USER_SESSION_READ_REPOSITORY)
    private readonly sessions: IUserSessionReadRepository,
    @Inject(VELOCITY_REPOSITORY)
    private readonly velocity: IVelocityRepository,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    private readonly config: EffectiveConfigService,
    private readonly registry: AssetRegistry,
    private readonly audit: AuditService,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  // ── listSessions ─────────────────────────────────────────────────────────────

  /** The user's active + recent auth sessions (Security tab). 404 if no user. */
  async listSessions(userId: string): Promise<AdminEndUserSession[]> {
    await this.assertUserExists(userId);
    const rows = await this.sessions.listForUser(userId, SESSIONS_LIMIT);
    return rows.map((s) => this.toSession(s));
  }

  // ── getLimits ────────────────────────────────────────────────────────────────

  /**
   * The user's effective per-tier caps (from layered config, resolved for the
   * user's tier + default fiat) plus live 24-h velocity usage. `effectiveLimits`
   * is null for an unverified user (no tier caps apply pre-verification).
   */
  async getLimits(userId: string): Promise<AdminEndUserLimitsResponse> {
    const user = await this.identity.loadUser(userId);
    if (user === null) throw new AdminNotFoundError('User');

    const fiatCurrency = this.registry.defaultFiat();
    const asOf = this.clock.now();
    const usage = await this.velocity.getDailyUsage(userId, asOf, fiatCurrency);

    const windowStart = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);

    return {
      effectiveLimits: this.resolveEffectiveLimits(user.kycTier, fiatCurrency),
      velocity: {
        dailyFiatUsed: usage.fiatTotal,
        dailyTxCount: usage.txCount,
        windowStart: windowStart.toISOString(),
        windowEnd: asOf.toISOString(),
      },
    };
  }

  // ── listTimeline ─────────────────────────────────────────────────────────────

  /**
   * The admin-action timeline — the hash-chained audit log filtered to this
   * user's subject (`User:<id>`), newest-first. Before/after snapshots are
   * intentionally not surfaced here (they can carry sensitive detail).
   */
  async listTimeline(userId: string): Promise<AdminEndUserTimelineEntry[]> {
    await this.assertUserExists(userId);
    const result = await this.audit.list({
      subject: `User:${userId}`,
      limit: TIMELINE_LIMIT,
    });
    return result.items.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor,
      actorAdminId: e.actorAdminId,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  // ── revokeSession ────────────────────────────────────────────────────────────

  /**
   * Force sign-out of a SINGLE end-user session. The revoke is scoped to the path
   * user (never a cross-user revoke) and only affects a still-live session; an
   * unknown/foreign/already-revoked id fails closed as 404 with NOTHING audited
   * (there was no state change to record). A real revoke is immutably audited as a
   * `session_revoke` against the user subject, carrying the operator's reason (§3.4).
   * Moves no money (§3.1).
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    reason: string,
    adminId: string,
  ): Promise<void> {
    await this.assertUserExists(userId);
    const revoked = await this.sessions.revokeSession(
      userId,
      sessionId,
      this.clock.now(),
      reason,
    );
    if (!revoked) throw new AdminNotFoundError('Session');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'session_revoke',
      after: { sessionId, reason },
    });
  }

  // ── revokeAllSessions ────────────────────────────────────────────────────────

  /**
   * Force sign-out of ALL the user's live sessions in one action. Idempotent — a
   * user with zero live sessions is a successful no-op (revokedCount 0). Always
   * audited (the operator's sign-out intent is recorded even at count 0), carrying
   * the revoked count + reason. Moves no money (§3.1).
   */
  async revokeAllSessions(
    userId: string,
    reason: string,
    adminId: string,
  ): Promise<void> {
    await this.assertUserExists(userId);
    const revokedCount = await this.sessions.revokeAllForUser(
      userId,
      this.clock.now(),
      reason,
    );

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'session_revoke',
      after: { scope: 'all', revokedCount, reason },
    });
  }

  // ── private helpers ────────────────────────────────────────────────────────────

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.identity.loadUser(userId);
    if (user === null) throw new AdminNotFoundError('User');
  }

  /**
   * Resolves the effective caps for the user's tier + fiat from layered config.
   * Returns null when the tier is unverified or the fiat has no configured
   * limits (fail-soft here — this is a read-only view, not a money gate).
   */
  private resolveEffectiveLimits(
    tier: string,
    fiatCurrency: string,
  ): AdminEndUserLimitsResponse['effectiveLimits'] {
    if (!(VERIFIED_TIERS as readonly string[]).includes(tier)) return null;
    const limits = this.config.get<LimitsConfig>('limits');
    const fiatLimits: FiatLimits | undefined = limits[fiatCurrency];
    if (!fiatLimits) return null;
    const caps: TierLimits = fiatLimits[tier as VerifiedTier];
    return {
      tier: tier as VerifiedTier,
      fiatCurrency,
      perTxFiatMax: String(caps.perTxFiatMax),
      dailyFiatMax: String(caps.dailyFiatMax),
      dailyTxCountMax: caps.dailyTxCountMax,
    };
  }

  private toSession(s: UserSessionRecord): AdminEndUserSession {
    return {
      id: s.id,
      channel: s.channel,
      deviceId: s.deviceId,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      isActive: s.isActive,
      stepUpCompletedAt: toIso(s.stepUpCompletedAt),
      issuedAt: s.issuedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      lastActivityAt: toIso(s.lastActivityAt),
      revokedAt: toIso(s.revokedAt),
    };
  }
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
