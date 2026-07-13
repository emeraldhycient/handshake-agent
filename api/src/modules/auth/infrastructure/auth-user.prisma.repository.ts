import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { KycTier, UserStatus } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
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

      return { userId: user.id, created: true };
    });
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
      // unconditional write: the `where: { kycTier: unverified }` clause is
      // evaluated atomically by Postgres, so this only ever fires for a fresh
      // `unverified` user. A user already at tier_1/2/3 re-hitting verify (e.g.
      // a stale/resent link) matches zero rows here — no downgrade, and no
      // tierChangedAt re-stamp, which would wrongly restart the tier-change
      // cooling-off window. Same guarded-updateMany shape as the pinnedDeviceId
      // guard in bindDevice below — no read-then-write race.
      await tx.user.updateMany({
        where: { id: userId, kycTier: KycTier.unverified },
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
    await this.prisma.user.updateMany({
      where: { id: input.userId, pinnedDeviceId: null },
      data: { pinnedDeviceId: device.id },
    });

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
    };
  }
}
