/**
 * Local/dev database seed — the QA users the visual-verify runbooks assume.
 *
 * Idempotent: every write is an upsert keyed by a natural unique (email / the
 * permission triple / role name), so running it repeatedly converges to the
 * same state and never duplicates rows. Safe to re-run after every
 * `prisma migrate deploy`.
 *
 * Seeds:
 *   1. The RBAC permission catalog + built-in roles (sourced from
 *      `@handshake-agent/contracts` — the single source of truth the API seeds
 *      from at bootstrap; mirrored here so a fresh DB is loginable without the
 *      one-time bootstrap-token dance).
 *   2. `admin@handshake.local` / `demopass123` — an ACTIVE super_admin
 *      (argon2id password hash; MFA off) for the web-admin console.
 *   3. `qa.fulltest@example.com` — an ACTIVE, email-verified, KYC-verified
 *      tier_1 end user for the web app (email-OTP login; no password).
 *
 * This is a DEV convenience only — it is never run in staging/prod. It moves no
 * money and confers no capability beyond what the normal bootstrap/KYC flows
 * already grant; the server-side gates (§3.1/§3.3) are unaffected.
 *
 * Run: `pnpm --filter @handshake-agent/api db:seed`
 */
import 'dotenv/config';

import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';

import {
  BUILTIN_ROLES,
  PERMISSION_CATALOG,
  permissionId,
} from '@handshake-agent/contracts';

// The generated client is the only sanctioned door to the DB (CLAUDE.md §3.2);
// a standalone seed script is an infrastructure-tier caller, like a repository.
import { PrismaClient } from '../generated/prisma/client';

const ADMIN_EMAIL = 'admin@handshake.local';
const ADMIN_PASSWORD = 'demopass123';
const QA_USER_EMAIL = 'qa.fulltest@example.com';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Upsert the whole permission catalog, keyed by the unique triple. */
async function seedPermissionCatalog(): Promise<Map<string, string>> {
  await prisma.$transaction(
    PERMISSION_CATALOG.map((entry) =>
      prisma.permission.upsert({
        where: {
          resourceType_resourceId_action: {
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            action: entry.action,
          },
        },
        create: {
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          action: entry.action,
          category: entry.category,
          description: entry.description,
        },
        update: { category: entry.category, description: entry.description },
      }),
    ),
  );

  // Map canonical catalog id → the persisted row id, for role assignment.
  const rows = await prisma.permission.findMany();
  return new Map(rows.map((row) => [permissionId(row), row.id]));
}

/** Idempotently create the built-in roles + their permission assignments. */
async function seedBuiltinRoles(
  permissionIdByCatalogId: Map<string, string>,
): Promise<string> {
  for (const def of BUILTIN_ROLES) {
    const grantedRowIds = PERMISSION_CATALOG.filter(def.grants)
      .map((entry) => permissionIdByCatalogId.get(permissionId(entry)))
      .filter((id): id is string => id !== undefined);

    const role = await prisma.role.upsert({
      where: { name: def.name },
      create: { name: def.name, description: def.description, isBuiltin: true },
      update: { description: def.description, isBuiltin: true },
    });

    // Replace the assignment set wholesale so a widened catalog is reflected.
    await prisma.rolePermissionAssignment.deleteMany({
      where: { roleId: role.id },
    });
    await prisma.rolePermissionAssignment.createMany({
      data: grantedRowIds.map((pid) => ({
        roleId: role.id,
        permissionId: pid,
      })),
    });
  }

  const superRole = await prisma.role.findUnique({
    where: { name: 'super_admin' },
    select: { id: true },
  });
  if (!superRole) throw new Error('super_admin role missing after seed');
  return superRole.id;
}

/** Upsert the ACTIVE super_admin console user (argon2id password). */
async function seedAdminUser(superRoleId: string): Promise<void> {
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
    type: argon2.argon2id,
  });
  await prisma.adminUser.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      displayName: 'QA Super Admin',
      passwordHash,
      status: 'active',
      mfaEnabled: false,
      roleId: superRoleId,
      acceptedAt: new Date(),
    },
    // Re-assert password + active status on re-run (never demote), but leave
    // an operator-enabled MFA secret in place if one exists.
    update: {
      passwordHash,
      status: 'active',
      roleId: superRoleId,
      failedLoginCount: 0,
      loginLockedUntil: null,
    },
  });
}

/** Upsert the ACTIVE, email-verified, KYC tier_1 end user (email-OTP login). */
async function seedQaEndUser(): Promise<void> {
  const now = new Date();
  const user = await prisma.user.upsert({
    where: { email: QA_USER_EMAIL },
    create: {
      email: QA_USER_EMAIL,
      status: 'active',
      kycStatus: 'verified',
      kycTier: 'tier_1',
      emailVerifiedAt: now,
      tierChangedAt: now,
    },
    update: {
      status: 'active',
      kycStatus: 'verified',
      kycTier: 'tier_1',
      emailVerifiedAt: now,
    },
    select: { id: true },
  });

  await prisma.kycProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      status: 'verified',
      tier: 'tier_1',
      firstName: 'QA',
      lastName: 'Fulltest',
      livenessCheckResult: 'passed',
      verifiedAt: now,
    },
    update: { status: 'verified', tier: 'tier_1', verifiedAt: now },
  });
}

async function main(): Promise<void> {
  const permissionIdByCatalogId = await seedPermissionCatalog();
  const superRoleId = await seedBuiltinRoles(permissionIdByCatalogId);
  await seedAdminUser(superRoleId);
  await seedQaEndUser();

  // eslint-disable-next-line no-console
  console.log(
    `Seed complete:\n` +
      `  admin  → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (active super_admin)\n` +
      `  user   → ${QA_USER_EMAIL} (active, verified, tier_1)`,
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
