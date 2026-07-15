import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import {
  DeviceTrustState,
  KycStatus,
  KycTier,
  ScreeningVerdict,
  UserStatus,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  AdminUserBalanceSummaryRecord,
  AdminUserListFilters,
  AdminUserListPage,
  AdminUserListRecord,
  AdminUserListResult,
  ChannelIdentityRecord,
  ContactRecord,
  DeviceRecord,
  IIdentityRepository,
  KycProfileRecord,
  KycQueueFilters,
  KycQueueListResult,
  KycQueueRecord,
  ProfileSettingsRecord,
  UserAdminDetailRecord,
  OriginatorIdentityRecord,
  UserRecord,
} from '../application/ports/identity.repository.port';

/** Columns selected for the KYC review-queue projection (user + KYC name/tier). */
const KYC_QUEUE_SELECT = {
  id: true,
  email: true,
  kycStatus: true,
  createdAt: true,
  kycProfile: {
    select: { firstName: true, lastName: true, tier: true },
  },
} as const;

interface KycQueueRow {
  id: string;
  email: string | null;
  kycStatus: string;
  createdAt: Date;
  kycProfile: {
    firstName: string | null;
    lastName: string | null;
    tier: string;
  } | null;
}

function toKycQueueRecord(row: KycQueueRow): KycQueueRecord {
  return {
    id: row.id,
    email: row.email,
    firstName: row.kycProfile?.firstName ?? null,
    lastName: row.kycProfile?.lastName ?? null,
    requestedTier: row.kycProfile?.tier ?? null,
    kycStatus: row.kycStatus,
    createdAt: row.createdAt,
  };
}

/**
 * Columns + relations selected for the admin user-list projection. The KYC name
 * join backs the derived displayName; `lastTransactionAt` is one of the three
 * last-active inputs (the other two — session + device — are batched below to
 * avoid N+1 fan-out per row).
 */
const ADMIN_USER_LIST_SELECT = {
  id: true,
  email: true,
  status: true,
  kycStatus: true,
  kycTier: true,
  simSwapDetectedAt: true,
  lastTransactionAt: true,
  createdAt: true,
  kycProfile: { select: { firstName: true, lastName: true } },
} as const;

interface AdminUserListRow {
  id: string;
  email: string | null;
  status: string;
  kycStatus: string;
  kycTier: string;
  simSwapDetectedAt: Date | null;
  lastTransactionAt: Date | null;
  createdAt: Date;
  kycProfile: { firstName: string | null; lastName: string | null } | null;
}

/** Per-user enrichment resolved in batch for a page of list rows. */
interface AdminUserListEnrichment {
  sanctionsFlaggedIds: Set<string>;
  balancesByUser: Map<string, AdminUserBalanceSummaryRecord[]>;
  lastActiveByUser: Map<string, Date>;
}

function toAdminUserListRecord(
  row: AdminUserListRow,
  enrichment: AdminUserListEnrichment,
): AdminUserListRecord {
  const sessionOrDevice = enrichment.lastActiveByUser.get(row.id) ?? null;
  const lastActiveAt = maxDate(sessionOrDevice, row.lastTransactionAt);
  return {
    id: row.id,
    email: row.email,
    firstName: row.kycProfile?.firstName ?? null,
    lastName: row.kycProfile?.lastName ?? null,
    status: row.status,
    kycStatus: row.kycStatus,
    kycTier: row.kycTier,
    simSwapDetectedAt: row.simSwapDetectedAt,
    sanctionsFlagged: enrichment.sanctionsFlaggedIds.has(row.id),
    balances: enrichment.balancesByUser.get(row.id) ?? [],
    lastActiveAt,
    createdAt: row.createdAt,
  };
}

/** The later of two nullable dates (null only when both are null). */
function maxDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
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
        tierChangedAt: true,
        createdAt: true,
        pinnedDeviceId: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      status: row.status,
      kycStatus: row.kycStatus,
      kycTier: row.kycTier,
      simSwapDetectedAt: row.simSwapDetectedAt,
      tierChangedAt: row.tierChangedAt,
      createdAt: row.createdAt,
      pinnedDeviceId: row.pinnedDeviceId,
    };
  }

  async findProfileSettings(
    userId: string,
  ): Promise<ProfileSettingsRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePhone: true, preferredFiatCurrency: true },
    });
    if (row === null) return null;
    return {
      profilePhone: row.profilePhone,
      preferredFiatCurrency: row.preferredFiatCurrency,
    };
  }

  async updateProfileSettings(
    userId: string,
    patch: { profilePhone?: string; preferredFiatCurrency?: string },
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(patch.profilePhone !== undefined
          ? { profilePhone: patch.profilePhone }
          : {}),
        ...(patch.preferredFiatCurrency !== undefined
          ? { preferredFiatCurrency: patch.preferredFiatCurrency }
          : {}),
      },
    });
  }

  async findKycProfile(userId: string): Promise<KycProfileRecord | null> {
    const row = await this.prisma.kycProfile.findUnique({
      where: { userId },
      select: { firstName: true, lastName: true },
    });

    if (row === null) return null;

    return { firstName: row.firstName, lastName: row.lastName };
  }

  async upsertKycProfileName(
    userId: string,
    input: { firstName: string; lastName: string },
  ): Promise<void> {
    await this.prisma.kycProfile.upsert({
      where: { userId },
      // status/tier are omitted on create — the schema defaults apply
      // (not_started / unverified), matching a pre-KYC onboarding write.
      create: {
        userId,
        firstName: input.firstName,
        lastName: input.lastName,
      },
      update: {
        firstName: input.firstName,
        lastName: input.lastName,
      },
    });
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
        ...(filters.kycStatus ? { kycStatus: filters.kycStatus } : {}),
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

  async listKycReviewQueue(
    filters: KycQueueFilters,
    page: AdminUserListPage,
  ): Promise<KycQueueListResult> {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, kycStatus: filters.status as KycStatus },
      select: KYC_QUEUE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > page.limit;
    const items = (hasMore ? rows.slice(0, page.limit) : rows).map(
      toKycQueueRecord,
    );
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  /**
   * Shared keyset pagination over the users table. Fetches `limit + 1` rows so
   * the presence of an extra row determines `nextCursor`, plus a matching
   * `count` for the filter-wide total. Ordered by createdAt desc, id desc for a
   * stable, deterministic cursor. Per-row extras (sanctions hit, wallet-balance
   * aggregate, true last-active) are resolved in one batch per relation over the
   * page's user ids — never a query per row.
   */
  private async paginatedUserList(
    where: Record<string, unknown>,
    page: AdminUserListPage,
  ): Promise<AdminUserListResult> {
    const scopedWhere = { deletedAt: null, ...where };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where: scopedWhere,
        select: ADMIN_USER_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      }),
      this.prisma.user.count({ where: scopedWhere }),
    ]);

    const hasMore = rows.length > page.limit;
    const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
    const enrichment = await this.enrichListRows(pageRows.map((r) => r.id));
    const items = pageRows.map((r) => toAdminUserListRecord(r, enrichment));
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor, total };
  }

  /**
   * Batch-resolves the list-row extras for a page of user ids: which users have
   * a prior sanctions `hit`, their per-asset wallet-balance aggregate, and the
   * latest session/device activity (combined with lastTransactionAt by the
   * mapper). One query per relation — no N+1.
   */
  private async enrichListRows(
    userIds: string[],
  ): Promise<AdminUserListEnrichment> {
    if (userIds.length === 0) {
      return {
        sanctionsFlaggedIds: new Set(),
        balancesByUser: new Map(),
        lastActiveByUser: new Map(),
      };
    }

    const [sanctionRows, balanceRows, sessionRows, deviceRows] =
      await Promise.all([
        this.prisma.sanctionsRecord.findMany({
          where: { userId: { in: userIds }, verdict: ScreeningVerdict.hit },
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.walletBalance.findMany({
          where: { wallet: { userId: { in: userIds } } },
          select: {
            asset: true,
            amount: true,
            syncedAt: true,
            wallet: { select: { userId: true } },
          },
          orderBy: { syncedAt: 'desc' },
        }),
        this.prisma.session.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _max: { lastActivityAt: true },
        }),
        this.prisma.device.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _max: { lastUsedAt: true },
        }),
      ]);

    const sanctionsFlaggedIds = new Set(
      sanctionRows
        .map((r) => r.userId)
        .filter((id): id is string => id !== null),
    );

    // Aggregate wallet balances to one line per (user, asset), keeping only the
    // newest snapshot per asset (rows are pre-sorted syncedAt desc).
    const balancesByUser = new Map<string, AdminUserBalanceSummaryRecord[]>();
    const seenAsset = new Map<string, Set<string>>();
    for (const row of balanceRows) {
      const uid = row.wallet.userId;
      const seen = seenAsset.get(uid) ?? new Set<string>();
      if (seen.has(row.asset)) continue;
      seen.add(row.asset);
      seenAsset.set(uid, seen);
      const list = balancesByUser.get(uid) ?? [];
      list.push({ asset: row.asset, amount: row.amount.toString() });
      balancesByUser.set(uid, list);
    }

    const lastActiveByUser = new Map<string, Date>();
    for (const s of sessionRows) {
      if (s._max.lastActivityAt) {
        lastActiveByUser.set(s.userId, s._max.lastActivityAt);
      }
    }
    for (const d of deviceRows) {
      const at = d._max.lastUsedAt;
      if (!at) continue;
      const current = lastActiveByUser.get(d.userId) ?? null;
      lastActiveByUser.set(d.userId, maxDate(current, at) as Date);
    }

    return { sanctionsFlaggedIds, balancesByUser, lastActiveByUser };
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

  async hasSanctionsHit(userId: string): Promise<boolean> {
    const hit = await this.prisma.sanctionsRecord.findFirst({
      where: { userId, verdict: ScreeningVerdict.hit },
      select: { id: true },
    });
    return hit !== null;
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
      // Stamp the tier-change time so the gate can enforce the post-change cooling-off.
      data: { kycTier: tier as KycTier, tierChangedAt: new Date() },
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

  async resetKycToPending(userId: string): Promise<void> {
    // User + KycProfile move together (§3.3): a single transaction so the gate
    // never observes a partial reset. updateMany scoped by userId is a no-op
    // (count 0) when no profile exists — the reset must not throw for a user
    // who never completed KYC.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { kycStatus: KycStatus.pending },
      });
      await tx.kycProfile.updateMany({
        where: { userId },
        data: { status: KycStatus.pending },
      });
    });
  }
}
