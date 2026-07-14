import { randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import {
  KycTier,
  Prisma,
  UserStatus,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DeviceAlreadyBoundError } from '../domain/auth-errors';
import type {
  AuthUserRecord,
  IAuthUserRepository,
  MeProjection,
} from '../application/ports/auth-user.repository.port';

function normalizePhone(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone}`;
}

@Injectable()
export class AuthUserPrismaRepository implements IAuthUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSignup(input: {
    email: string;
    phone?: string;
  }): Promise<{ userId: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();
    const trimmedPhone = input.phone?.trim();
    const phone =
      trimmedPhone && trimmedPhone.length > 0
        ? normalizePhone(trimmedPhone)
        : null;

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) return { userId: existing.id, created: false };

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, status: 'provisional' },
        select: { id: true },
      });

      // Email-only signup (no phone) creates no ChannelIdentity at all.
      if (phone !== null) {
        // Pending WhatsApp ChannelIdentity = the later-link hook (§3.4). Skip if
        // the phone already has an active WhatsApp CI (avoid hijack / unique
        // clash).
        const existingCi = await tx.channelIdentity.findFirst({
          where: {
            channel: 'whatsapp',
            channelAddress: phone,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existingCi === null) {
          await tx.channelIdentity.create({
            data: {
              channel: 'whatsapp',
              channelAddress: phone,
              normalizedPhone: phone,
              userId: user.id,
              verificationStatus: 'pending',
            },
          });
        }
      }

      await this.mintPayId(tx, user.id, email);

      return { userId: user.id, created: true };
    });
  }

  /**
   * Mints a unique PayID for a freshly created user, derived from the email
   * local-part, and writes it via `tx.user.update` inside the caller's
   * transaction (atomic with the `user.create` in `createSignup`).
   *
   * Collisions are expected — two users can share an email local-part across
   * different domains (`alice@a.com` / `alice@b.com`) — and are resolved by
   * catching the P2002 unique-constraint violation (mirrors `bindDevice`
   * above) and retrying with an incrementing numeric suffix. After a handful
   * of numeric retries exhaust (pathological pile-up on one slug), a random
   * suffix guarantees termination without an unbounded loop.
   *
   * Each attempt is wrapped in its own SAVEPOINT. This is load-bearing, not
   * defensive polish: Postgres aborts the ENTIRE surrounding transaction the
   * instant one statement inside it errors — catching the P2002 in JS does
   * not undo that at the DB-session level, so a naive retry loop's second
   * `tx.user.update` would fail with "current transaction is aborted,
   * commands ignored until end of transaction block" (a plain
   * `DriverAdapterError`, not a `PrismaClientKnownRequestError`/P2002), which
   * would bubble out uncaught and 500 the whole signup — discarding the
   * already-created user and ChannelIdentity along with it. Rolling back to
   * the savepoint on failure restores the transaction to a usable state so
   * the next candidate (or the caller's subsequent statements) can proceed.
   */
  private async mintPayId(
    tx: Prisma.TransactionClient,
    userId: string,
    seed: string,
  ): Promise<string> {
    const base =
      (seed.split('@')[0] || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 26) || 'user';
    const slug = base.length < 3 ? `${base}user` : base;

    const tryCandidate = async (candidate: string): Promise<boolean> => {
      await tx.$executeRawUnsafe('SAVEPOINT mint_payid_attempt');
      try {
        await tx.user.update({
          where: { id: userId },
          data: { payId: candidate },
        });
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT mint_payid_attempt');
        return true;
      } catch (err) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT mint_payid_attempt');
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          return false;
        }
        throw err;
      }
    };

    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = attempt === 0 ? slug : `${slug.slice(0, 26)}${attempt}`;
      if (await tryCandidate(candidate)) return candidate;
    }

    // Numeric suffixes exhausted — fall back to a random 4-digit suffix. A
    // collision here is astronomically unlikely but not impossible, so this
    // still isn't wrapped in a retry loop of its own; a repeat P2002 at this
    // point surfaces as a genuine failure rather than silently looping
    // forever or leaving the user without a payId.
    const randomSuffix = randomInt(1000, 10000);
    const fallback = `${slug.slice(0, 22)}${randomSuffix}`;
    if (await tryCandidate(fallback)) return fallback;
    throw new Error(`mintPayId: exhausted retries for seed "${seed}"`);
  }

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        kycStatus: true,
        kycTier: true,
        pinHash: true,
      },
    });
    if (row === null || row.email === null) return null;
    return {
      id: row.id,
      email: row.email,
      emailVerifiedAt: row.emailVerifiedAt,
      kycStatus: row.kycStatus,
      kycTier: row.kycTier,
      pinHash: row.pinHash,
    };
  }

  async markEmailVerified(userId: string, now: Date): Promise<void> {
    // Both writes run in one interactive transaction (same shape as
    // createSignup above): if the process crashes or the DB errors between
    // them, a non-transactional pair could leave a user with emailVerifiedAt
    // set but still `unverified` — and since resendEmailVerification only
    // re-issues a token when emailVerifiedAt is null, that user would be
    // permanently stuck below tier_1 with no way to retrigger the grant.
    // $transaction makes the pair all-or-nothing.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: now },
      });

      // Task 2.1 (onboarding redesign): an email-verified account may transact
      // tier_1 capabilities (buy/receive) immediately — KycGateService already
      // admits tier_1 regardless of kycStatus (§3.3). Guarded promotion, NOT an
      // unconditional write: the `where` clause is evaluated atomically by
      // Postgres, so this only ever fires for a fresh, PROVISIONAL, `unverified`
      // user. A user already at tier_1/2/3 re-hitting verify (e.g. a stale/
      // resent link) matches zero rows here — no downgrade, and no tierChangedAt
      // re-stamp, which would wrongly restart the tier-change cooling-off window.
      //
      // `status: provisional` in the guard is a security control (not just no-
      // downgrade): fresh signups are created `provisional` (see createSignup),
      // so scoping the `status: active` promotion to `provisional` means an
      // operator-suspended/deactivated account that is still `unverified` can
      // NEVER be silently reactivated as a side effect of completing email
      // verification — the promotion simply matches zero rows and the suspension
      // stands. Same guarded-updateMany shape as the pinnedDeviceId guard below.
      await tx.user.updateMany({
        where: {
          id: userId,
          kycTier: KycTier.unverified,
          status: UserStatus.provisional,
        },
        data: {
          kycTier: KycTier.tier_1,
          status: UserStatus.active,
          tierChangedAt: now,
        },
      });
    });
  }

  async bindDevice(input: {
    userId: string;
    fingerprint: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ deviceId: string }> {
    const now = new Date();
    const device = await this.prisma.device.upsert({
      where: { fingerprint: input.fingerprint },
      create: {
        userId: input.userId,
        fingerprint: input.fingerprint,
        trustState: 'bound',
        userAgent: input.userAgent,
        ipAddressAtBinding: input.ip,
        boundAt: now,
        lastUsedAt: now,
      },
      update: { lastUsedAt: now, trustState: 'bound' },
      select: { id: true },
    });

    // Pin on first bind (User.pinnedDeviceId is unique; only set when null).
    // The `pinnedDeviceId: null` guard means this only fires when the user has no
    // pinned device — but the device itself may already be pinned to ANOTHER user
    // (a shared/re-used browser, §3.4 one-device-per-identity). That trips the
    // unique constraint (P2002); map it to a clean domain error so the caller can
    // return a 409 instead of leaking a raw Prisma error as an opaque 500.
    try {
      await this.prisma.user.updateMany({
        where: { id: input.userId, pinnedDeviceId: null },
        data: { pinnedDeviceId: device.id },
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new DeviceAlreadyBoundError();
      }
      throw err;
    }

    return { deviceId: device.id };
  }

  async loadMe(userId: string): Promise<MeProjection | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        kycStatus: true,
        kycTier: true,
        pinHash: true,
        payId: true,
        kycProfile: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    if (row === null || row.email === null) return null;
    return {
      userId: row.id,
      email: row.email,
      kycStatus: row.kycStatus,
      kycTier: row.kycTier,
      hasPin: row.pinHash !== null,
      emailVerified: row.emailVerifiedAt !== null,
      firstName: row.kycProfile?.firstName ?? null,
      lastName: row.kycProfile?.lastName ?? null,
      payId: row.payId,
    };
  }
}
