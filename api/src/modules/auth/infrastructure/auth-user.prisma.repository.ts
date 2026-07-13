import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../../generated/prisma/client';

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
    phone: string;
  }): Promise<{ userId: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();
    const phone = normalizePhone(input.phone.trim());

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

      // Pending WhatsApp ChannelIdentity = the later-link hook (§3.4). Skip if
      // the phone already has an active WhatsApp CI (avoid hijack / unique clash).
      const existingCi = await tx.channelIdentity.findFirst({
        where: { channel: 'whatsapp', channelAddress: phone, deletedAt: null },
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
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: now },
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
      firstName: row.kycProfile?.firstName ?? null,
      lastName: row.kycProfile?.lastName ?? null,
    };
  }
}
