import { Injectable } from '@nestjs/common';

import type { AdminUser } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { resolveAdminDisplayName } from '../application/admin-user.service';
import {
  type AdminUserRecord,
  type CreateInvitedAdminInput,
  type IAdminUserRepository,
  type ListAdminUsersQuery,
  type ListAdminUsersResult,
} from '../application/ports/admin-user.repository.port';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminUserPrismaRepository implements IAdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createInvited(
    input: CreateInvitedAdminInput,
  ): Promise<AdminUserRecord> {
    const row = await this.prisma.adminUser.create({
      data: {
        email: input.email,
        roleId: input.roleId,
        // Blank when unset; readers (toRecord) fall back to the email local-part.
        displayName: input.displayName?.trim() ?? '',
        // Pending admins have no usable credential until they accept.
        passwordHash: '',
        status: 'pending',
      },
      include: { role: { select: { name: true } } },
    });
    return toRecord(row);
  }

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    const row = await this.prisma.adminUser.findUnique({
      where: { email },
      include: { role: { select: { name: true } } },
    });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<AdminUserRecord | null> {
    const row = await this.prisma.adminUser.findUnique({
      where: { id },
      include: { role: { select: { name: true } } },
    });
    return row ? toRecord(row) : null;
  }

  async list(query: ListAdminUsersQuery): Promise<ListAdminUsersResult> {
    const take = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const rows = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { role: { select: { name: true } } },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = page.map(toRecord);
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async setStatus(
    id: string,
    status: 'active' | 'suspended' | 'offboarded',
    at: Date,
  ): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: {
        status,
        ...(status === 'suspended' ? { suspendedAt: at } : {}),
        ...(status === 'offboarded' ? { offboardedAt: at } : {}),
      },
    });
  }

  async updateRole(id: string, roleId: string): Promise<void> {
    await this.prisma.adminUser.update({ where: { id }, data: { roleId } });
  }

  async setDisplayName(id: string, displayName: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: { displayName },
    });
  }

  async setPasswordAndActivate(
    id: string,
    passwordHash: string,
    at: Date,
    displayName?: string,
  ): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: {
        passwordHash,
        status: 'active',
        acceptedAt: at,
        // Only overwrite when a non-empty name is supplied.
        ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
      },
    });
  }

  async enableMfa(
    id: string,
    encSecret: string,
    hashedRecoveryCodes: string[],
  ): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: {
        mfaEnabled: true,
        mfaSecret: encSecret,
        mfaRecoveryCodes: hashedRecoveryCodes,
      },
    });
  }

  async disableMfa(id: string): Promise<void> {
    // Reset-2FA-for-another-admin: clear the second factor entirely. The target
    // must re-enroll. No secret is read or returned (§3.4).
    await this.prisma.adminUser.update({
      where: { id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
      },
    });
  }

  async consumeRecoveryCode(
    id: string,
    matches: (codeHash: string) => boolean,
  ): Promise<boolean> {
    // Serialize load → mutate → write so two concurrent consumers can't both
    // burn the same code (the row is locked for the transaction's duration).
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.adminUser.findUnique({
        where: { id },
        select: { mfaRecoveryCodes: true },
      });
      if (!row) {
        return false;
      }
      const index = row.mfaRecoveryCodes.findIndex(matches);
      if (index === -1) {
        return false;
      }
      const remaining = row.mfaRecoveryCodes.filter((_, i) => i !== index);
      await tx.adminUser.update({
        where: { id },
        data: { mfaRecoveryCodes: remaining },
      });
      return true;
    });
  }

  async recordLogin(id: string, at: Date): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: { lastLoginAt: at },
    });
  }

  async registerFailedLogin(
    id: string,
    now: Date,
  ): Promise<{ count: number; lockedUntil: Date | null }> {
    // ONE atomic statement folds the expired-window reset INTO the increment.
    // A separate resetLoginFailures()-then-increment could interleave under a
    // concurrent credential-stuffing burst on a just-expired lock and let every
    // attempt reach the argon2 verify — the TOCTOU brute-force bypass (§3.3,
    // mirrors PinService.registerFailedAttempt). Postgres serializes the row
    // update, so concurrent callers observe strictly increasing counts. `now`
    // is the service clock (not the DB clock) so lockout timing is deterministic.
    const rows = await this.prisma.$queryRaw<
      Array<{ failedLoginCount: number; loginLockedUntil: Date | null }>
    >`
      UPDATE "admin_users"
      SET
        "failedLoginCount" = CASE
          WHEN "loginLockedUntil" IS NOT NULL AND "loginLockedUntil" >  ${now} THEN "failedLoginCount"
          WHEN "loginLockedUntil" IS NOT NULL AND "loginLockedUntil" <= ${now} THEN 1
          ELSE "failedLoginCount" + 1
        END,
        "loginLockedUntil" = CASE
          WHEN "loginLockedUntil" IS NOT NULL AND "loginLockedUntil" <= ${now} THEN NULL
          ELSE "loginLockedUntil"
        END
      WHERE "id" = ${id}::uuid
      RETURNING "failedLoginCount", "loginLockedUntil"
    `;

    const row = rows[0];
    // Row vanished between the caller's read and this update (rare delete race):
    // report a cleared counter so the caller does not lock a ghost.
    if (!row) return { count: 0, lockedUntil: null };

    return {
      count: Number(row.failedLoginCount),
      lockedUntil: row.loginLockedUntil ?? null,
    };
  }

  async setLoginLock(id: string, until: Date): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: { loginLockedUntil: until },
    });
  }

  async resetLoginFailures(id: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: { failedLoginCount: 0, loginLockedUntil: null },
    });
  }
}

// The record carries `passwordHash` as an extra field beyond AdminUserRecord:
// AdminAuthService / AdminStepUpService cast findByEmail / findById results to
// `AdminUserRecord & { passwordHash }` and verify against it. The API never
// surfaces it — controllers re-parse list/get rows through the contract schema,
// which strips this key.
function toRecord(
  row: AdminUser & { role: { name: string } },
): AdminUserRecord & { passwordHash: string } {
  return {
    id: row.id,
    email: row.email,
    // Fall back to the email local-part when the stored column is blank.
    displayName: resolveAdminDisplayName(row.email, row.displayName),
    status: row.status,
    mfaEnabled: row.mfaEnabled,
    mfaSecret: row.mfaSecret,
    mfaRecoveryCodes: row.mfaRecoveryCodes,
    roleId: row.roleId,
    roleName: row.role.name,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    failedLoginCount: row.failedLoginCount,
    loginLockedUntil: row.loginLockedUntil,
    passwordHash: row.passwordHash,
  };
}
