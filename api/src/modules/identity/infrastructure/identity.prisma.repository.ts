import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ChannelIdentityRecord,
  ContactRecord,
  IIdentityRepository,
  KycProfileRecord,
  UserRecord,
} from '../application/ports/identity.repository.port';

/**
 * Prisma adapter for the identity repository port. Maps DB rows to the
 * application-level record types; the application layer never sees Prisma types.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */
@Injectable()
export class IdentityPrismaRepository implements IIdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveChannelIdentity(
    channel: string,
    channelAddress: string,
  ): Promise<ChannelIdentityRecord | null> {
    const row = await this.prisma.channelIdentity.findFirst({
      where: {
        channel: channel as never,
        channelAddress,
        deletedAt: null,
      },
      select: {
        id: true,
        channel: true,
        channelAddress: true,
        contactId: true,
        userId: true,
        simSwapDetectedAt: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      channel: row.channel,
      channelAddress: row.channelAddress,
      contactId: row.contactId,
      userId: row.userId,
      simSwapDetectedAt: row.simSwapDetectedAt,
    };
  }

  async findWhatsAppAddressByUserId(userId: string): Promise<string | null> {
    const row = await this.prisma.channelIdentity.findFirst({
      where: {
        userId,
        channel: 'whatsapp' as never,
        deletedAt: null,
      },
      select: { channelAddress: true },
    });

    return row?.channelAddress ?? null;
  }

  async loadUser(userId: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        kycStatus: true,
        kycTier: true,
        simSwapDetectedAt: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      status: row.status,
      kycStatus: row.kycStatus,
      kycTier: row.kycTier,
      simSwapDetectedAt: row.simSwapDetectedAt,
    };
  }

  async findKycProfile(userId: string): Promise<KycProfileRecord | null> {
    const row = await this.prisma.kycProfile.findUnique({
      where: { userId },
      select: { firstName: true, lastName: true },
    });

    if (row === null) return null;

    return { firstName: row.firstName, lastName: row.lastName };
  }

  async loadContact(contactId: string): Promise<ContactRecord | null> {
    const row = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        primaryChannel: true,
        primaryAddress: true,
        status: true,
        linkedUserId: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      primaryChannel: row.primaryChannel,
      primaryAddress: row.primaryAddress,
      status: row.status,
      linkedUserId: row.linkedUserId,
    };
  }

  async createContactWithChannelIdentity(input: {
    channel: string;
    channelAddress: string;
    normalizedPhone?: string;
  }): Promise<{
    contact: ContactRecord;
    channelIdentity: ChannelIdentityRecord;
  }> {
    const { channel, channelAddress, normalizedPhone } = input;

    // Both rows must be created atomically so we never have a CI without a Contact.
    const result = await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          primaryChannel: channel as never,
          primaryAddress: channelAddress,
        },
        select: {
          id: true,
          primaryChannel: true,
          primaryAddress: true,
          status: true,
          linkedUserId: true,
        },
      });

      const channelIdentity = await tx.channelIdentity.create({
        data: {
          channel: channel as never,
          channelAddress,
          normalizedPhone,
          contactId: contact.id,
        },
        select: {
          id: true,
          channel: true,
          channelAddress: true,
          contactId: true,
          userId: true,
          simSwapDetectedAt: true,
        },
      });

      return { contact, channelIdentity };
    });

    return {
      contact: {
        id: result.contact.id,
        primaryChannel: result.contact.primaryChannel,
        primaryAddress: result.contact.primaryAddress,
        status: result.contact.status,
        linkedUserId: result.contact.linkedUserId,
      },
      channelIdentity: {
        id: result.channelIdentity.id,
        channel: result.channelIdentity.channel,
        channelAddress: result.channelIdentity.channelAddress,
        contactId: result.channelIdentity.contactId,
        userId: result.channelIdentity.userId,
        simSwapDetectedAt: result.channelIdentity.simSwapDetectedAt,
      },
    };
  }
}
