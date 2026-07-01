import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import {
  DeviceTrustState,
  KycStatus,
  KycTier,
  UserStatus,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  AdminUserListFilters,
  AdminUserListPage,
  AdminUserListRecord,
  AdminUserListResult,
  ChannelIdentityRecord,
  ContactRecord,
  DeviceRecord,
  IIdentityRepository,
  KycProfileRecord,
  UserAdminDetailRecord,
  OriginatorIdentityRecord,
  UserRecord,
} from '../application/ports/identity.repository.port';

/** Columns selected for the admin user-list projection. */
const ADMIN_USER_LIST_SELECT = {
  id: true,
  email: true,
  status: true,
  kycStatus: true,
  kycTier: true,
  simSwapDetectedAt: true,
  createdAt: true,
} as const;

interface AdminUserListRow {
  id: string;
  email: string | null;
  status: string;
  kycStatus: string;
  kycTier: string;
  simSwapDetectedAt: Date | null;
  createdAt: Date;
}

function toAdminUserListRecord(row: AdminUserListRow): AdminUserListRecord {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    kycStatus: row.kycStatus,
    kycTier: row.kycTier,
    simSwapDetectedAt: row.simSwapDetectedAt,
    createdAt: row.createdAt,
  };
}

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

  async findOriginatorIdentity(
    userId: string,
  ): Promise<OriginatorIdentityRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        verifiedEmail: true,
        email: true,
        kycProfile: { select: { firstName: true, lastName: true } },
      },
    });

    if (row === null) return null;

    return {
      firstName: row.kycProfile?.firstName ?? null,
      lastName: row.kycProfile?.lastName ?? null,
      verifiedEmail: row.verifiedEmail,
      email: row.email,
    };
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

  // -------------------------------------------------------------------------
  // Admin user-management + KYC-review reads/writes (Phase 2, Task 2).
  // -------------------------------------------------------------------------

  async listUsers(
    filters: AdminUserListFilters,
    page: AdminUserListPage,
  ): Promise<AdminUserListResult> {
    return this.paginatedUserList(
      {
        ...(filters.query
          ? { email: { contains: filters.query, mode: 'insensitive' } }
          : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.kycTier ? { kycTier: filters.kycTier } : {}),
      },
      page,
    );
  }

  async listUsersPendingKycReview(
    page: AdminUserListPage,
  ): Promise<AdminUserListResult> {
    return this.paginatedUserList(
      { kycStatus: KycStatus.pending_review },
      page,
    );
  }

  /**
   * Shared keyset pagination over the users table. Fetches `limit + 1` rows so
   * the presence of an extra row determines `nextCursor` without a count query.
   * Ordered by createdAt desc, id desc for a stable, deterministic cursor.
   */
  private async paginatedUserList(
    where: Record<string, unknown>,
    page: AdminUserListPage,
  ): Promise<AdminUserListResult> {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, ...where },
      select: ADMIN_USER_LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > page.limit;
    const items = (hasMore ? rows.slice(0, page.limit) : rows).map(
      toAdminUserListRecord,
    );
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  async loadUserWithKycAndDevices(
    userId: string,
  ): Promise<UserAdminDetailRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        kycStatus: true,
        kycTier: true,
        simSwapDetectedAt: true,
        createdAt: true,
        pinnedDeviceId: true,
        kycProfile: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            nin: true,
            bvn: true,
            idDocumentType: true,
            livenessCheckResult: true,
            status: true,
            tier: true,
            rejectionReason: true,
          },
        },
        devices: {
          select: {
            id: true,
            trustState: true,
            lastUsedAt: true,
            boundAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      email: row.email,
      status: row.status,
      kycStatus: row.kycStatus,
      kycTier: row.kycTier,
      simSwapDetectedAt: row.simSwapDetectedAt,
      createdAt: row.createdAt,
      pinnedDeviceId: row.pinnedDeviceId,
      kyc:
        row.kycProfile === null
          ? null
          : {
              firstName: row.kycProfile.firstName,
              lastName: row.kycProfile.lastName,
              dateOfBirth: row.kycProfile.dateOfBirth,
              nin: row.kycProfile.nin,
              bvn: row.kycProfile.bvn,
              idDocumentType: row.kycProfile.idDocumentType,
              livenessCheckResult: row.kycProfile.livenessCheckResult,
              status: row.kycProfile.status,
              tier: row.kycProfile.tier,
              rejectionReason: row.kycProfile.rejectionReason,
            },
      devices: row.devices.map((d) => ({
        id: d.id,
        trustState: d.trustState,
        lastUsedAt: d.lastUsedAt,
        boundAt: d.boundAt,
      })),
    };
  }

  async listDevicesForUser(userId: string): Promise<DeviceRecord[]> {
    const rows = await this.prisma.device.findMany({
      where: { userId },
      select: { id: true, trustState: true, lastUsedAt: true, boundAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((d) => ({
      id: d.id,
      trustState: d.trustState,
      lastUsedAt: d.lastUsedAt,
      boundAt: d.boundAt,
    }));
  }

  async setUserStatus(userId: string, status: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: status as UserStatus },
    });
  }

  async setKycTier(userId: string, tier: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { kycTier: tier as KycTier },
    });
  }

  async setSimSwapDetectedAt(userId: string, at: Date | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { simSwapDetectedAt: at },
    });
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.prisma.device.update({
      where: { id: deviceId },
      data: { trustState: DeviceTrustState.revoked },
    });
  }

  async unpinDevice(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinnedDeviceId: null },
    });
  }
}
