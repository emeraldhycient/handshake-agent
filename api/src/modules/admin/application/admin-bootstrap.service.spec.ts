import { createHash } from 'node:crypto';

import {
  AdminBootstrapForbiddenError,
  AdminNotFoundError,
} from '../domain/admin-errors';
import { AdminBootstrapService } from './admin-bootstrap.service';
import type { PermissionCatalogService } from './permission-catalog.service';
import type { RoleService } from './role.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  AdminInvitationCreatedRecord,
  CreateAdminInvitationInput,
  IAdminInvitationRepository,
} from './ports/admin-invitation.repository.port';
import type {
  AdminUserRecord,
  CreateInvitedAdminInput,
  IAdminUserRepository,
} from './ports/admin-user.repository.port';
import type {
  IRoleRepository,
  RoleWithPermissions,
} from './ports/role.repository.port';

const BOOTSTRAP_TOKEN = 'the-secret-bootstrap-token';

function sha256(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

function makeConfig(token = BOOTSTRAP_TOKEN): { get: (k: string) => unknown } {
  return { get: () => token };
}

function makeInvRepo(adminCount = 0): {
  repo: IAdminInvitationRepository;
  creates: CreateAdminInvitationInput[];
} {
  const creates: CreateAdminInvitationInput[] = [];
  const repo = {
    create(
      input: CreateAdminInvitationInput,
    ): Promise<AdminInvitationCreatedRecord> {
      creates.push(input);
      return Promise.resolve({
        id: 'inv-boot',
        email: input.email,
        expiresAt: input.expiresAt,
      });
    },
    countAdmins: () => Promise.resolve(adminCount),
  } as unknown as IAdminInvitationRepository;
  return { repo, creates };
}

function makeUserRepo(): {
  repo: IAdminUserRepository;
  invited: CreateInvitedAdminInput[];
} {
  const invited: CreateInvitedAdminInput[] = [];
  const repo = {
    createInvited(input: CreateInvitedAdminInput): Promise<AdminUserRecord> {
      invited.push(input);
      return Promise.resolve({
        id: 'user-boot',
        email: input.email,
        status: 'pending',
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
        roleId: input.roleId,
        createdAt: new Date(),
        lastLoginAt: null,
      });
    },
  } as unknown as IAdminUserRepository;
  return { repo, invited };
}

function makeRoleRepo(superRole?: RoleWithPermissions | null): IRoleRepository {
  const role: RoleWithPermissions | null =
    superRole === undefined
      ? {
          id: 'role-super',
          name: 'super_admin',
          description: 'x',
          isBuiltin: true,
          permissionIds: [],
        }
      : superRole;
  return {
    findByName: () => Promise.resolve(role),
  } as unknown as IRoleRepository;
}

function makeCatalog(): {
  svc: PermissionCatalogService;
  state: { calls: number };
} {
  const state = { calls: 0 };
  const svc = {
    syncCatalog(): Promise<void> {
      state.calls += 1;
      return Promise.resolve();
    },
  } as unknown as PermissionCatalogService;
  return { svc, state };
}

function makeRoleSvc(): { svc: RoleService; state: { calls: number } } {
  const state = { calls: 0 };
  const svc = {
    seedBuiltins(): Promise<void> {
      state.calls += 1;
      return Promise.resolve();
    },
  } as unknown as RoleService;
  return { svc, state };
}

function makeAudit(): { audit: AuditService; calls: RecordAuditInput[] } {
  const calls: RecordAuditInput[] = [];
  const audit = {
    record(input: RecordAuditInput): Promise<void> {
      calls.push(input);
      return Promise.resolve();
    },
  } as unknown as AuditService;
  return { audit, calls };
}

function build(opts?: {
  configToken?: string;
  adminCount?: number;
  superRole?: RoleWithPermissions | null;
}) {
  const config = makeConfig(opts?.configToken);
  const inv = makeInvRepo(opts?.adminCount ?? 0);
  const users = makeUserRepo();
  const roles = makeRoleRepo(opts?.superRole);
  const catalog = makeCatalog();
  const roleSvc = makeRoleSvc();
  const audit = makeAudit();
  const service = new AdminBootstrapService(
    config as never,
    inv.repo,
    users.repo,
    roles,
    catalog.svc,
    roleSvc.svc,
    audit.audit,
  );
  return { service, inv, users, catalog, roleSvc, audit };
}

describe('AdminBootstrapService', () => {
  const now = new Date('2026-06-30T00:00:00Z');

  it('throws AdminBootstrapForbiddenError on an empty token', async () => {
    const { service } = build();
    await expect(
      service.bootstrap('', 'root@b.co', now),
    ).rejects.toBeInstanceOf(AdminBootstrapForbiddenError);
  });

  it('throws AdminBootstrapForbiddenError on a wrong token', async () => {
    const { service } = build();
    await expect(
      service.bootstrap('wrong-token', 'root@b.co', now),
    ).rejects.toBeInstanceOf(AdminBootstrapForbiddenError);
  });

  it('throws AdminBootstrapForbiddenError when admins already exist', async () => {
    const { service } = build({ adminCount: 1 });
    await expect(
      service.bootstrap(BOOTSTRAP_TOKEN, 'root@b.co', now),
    ).rejects.toBeInstanceOf(AdminBootstrapForbiddenError);
  });

  it('throws AdminNotFoundError when the super_admin role is missing', async () => {
    const { service } = build({ superRole: null });
    await expect(
      service.bootstrap(BOOTSTRAP_TOKEN, 'root@b.co', now),
    ).rejects.toBeInstanceOf(AdminNotFoundError);
  });

  it('seeds catalog + roles, invites the first super_admin, and returns a token', async () => {
    const { service, inv, users, catalog, roleSvc, audit } = build();

    const result = await service.bootstrap(BOOTSTRAP_TOKEN, 'root@b.co', now);

    expect(catalog.state.calls).toBe(1);
    expect(roleSvc.state.calls).toBe(1);

    // pending super_admin user created
    expect(users.invited).toEqual([
      { email: 'root@b.co', roleId: 'role-super' },
    ]);

    // invitation stores hash, self-references the created user, 7-day expiry
    expect(inv.creates).toHaveLength(1);
    const created = inv.creates[0];
    expect(created.email).toBe('root@b.co');
    expect(created.roleId).toBe('role-super');
    expect(created.createdByAdminId).toBe('user-boot');
    expect(created.reason).toBe('bootstrap');
    expect(created.expiresAt.getTime()).toBe(
      now.getTime() + 7 * 24 * 3600 * 1000,
    );
    expect(created.tokenHash).toBe(sha256(result.invitationToken));

    // returned plaintext token, once
    expect(result.invitationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.invitationId).toBe('inv-boot');
    expect(result.expiresAt.getTime()).toBe(
      now.getTime() + 7 * 24 * 3600 * 1000,
    );

    // audited as a system actor (no admin id yet)
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].action).toBe('admin_update');
    expect(audit.calls[0].actorAdminId).toBeFalsy();
  });
});
