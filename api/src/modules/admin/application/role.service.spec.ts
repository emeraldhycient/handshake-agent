import {
  BUILTIN_ROLES,
  PERMISSION_CATALOG,
  permissionId,
} from '@handshake-agent/contracts';

import { BuiltinRoleImmutableError } from '../domain/admin-errors';
import { RoleService } from './role.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  CreateRoleInput,
  IRoleRepository,
  RoleRecord,
  RoleWithPermissions,
  UpdateRoleInput,
} from './ports/role.repository.port';

interface RepoState {
  byName: Record<string, RoleWithPermissions | null>;
  byId: Record<string, RoleWithPermissions | null>;
  creates: CreateRoleInput[];
  updates: { id: string; input: UpdateRoleInput }[];
}

function makeRepo(state?: Partial<RepoState>): {
  repo: IRoleRepository;
  state: RepoState;
} {
  const s: RepoState = {
    byName: state?.byName ?? {},
    byId: state?.byId ?? {},
    creates: [],
    updates: [],
  };
  const repo: IRoleRepository = {
    create(input): Promise<RoleRecord> {
      s.creates.push(input);
      return Promise.resolve({
        id: `role-${input.name}`,
        name: input.name,
        description: input.description,
        isBuiltin: input.isBuiltin,
      });
    },
    findById: (id) => Promise.resolve(s.byId[id] ?? null),
    findByName: (name) => Promise.resolve(s.byName[name] ?? null),
    list: () =>
      Promise.resolve(
        Object.values(s.byId).filter(
          (r): r is RoleWithPermissions => r !== null,
        ),
      ),
    update(id, input): Promise<void> {
      s.updates.push({ id, input });
      return Promise.resolve();
    },
    countAdmins: () => Promise.resolve(0),
  };
  return { repo, state: s };
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

describe('RoleService', () => {
  describe('seedBuiltins', () => {
    it('creates only missing roles with the correct permissionIds', async () => {
      // super_admin already exists; the rest are missing.
      const existing: RoleWithPermissions = {
        id: 'role-super',
        name: 'super_admin',
        description: 'x',
        isBuiltin: true,
        permissionIds: [],
      };
      const { repo, state } = makeRepo({ byName: { super_admin: existing } });
      const { audit } = makeAudit();

      await new RoleService(repo, audit).seedBuiltins();

      const createdNames = state.creates.map((c) => c.name);
      expect(createdNames).not.toContain('super_admin');
      expect(createdNames).toEqual(
        BUILTIN_ROLES.filter((r) => r.name !== 'super_admin').map(
          (r) => r.name,
        ),
      );

      const ops = BUILTIN_ROLES.find((r) => r.name === 'ops')!;
      const opsCreate = state.creates.find((c) => c.name === 'ops')!;
      expect(opsCreate.isBuiltin).toBe(true);
      expect(opsCreate.permissionIds).toEqual(
        PERMISSION_CATALOG.filter(ops.grants).map(permissionId),
      );
    });
  });

  describe('create', () => {
    it('creates a non-builtin role and audits admin_update', async () => {
      const { repo, state } = makeRepo();
      const { audit, calls } = makeAudit();

      const input = {
        name: 'custom',
        description: 'A custom role',
        permissionIds: ['api_route:GET /admin/audit:read'],
      };
      const created = await new RoleService(repo, audit).create(
        input,
        'admin-1',
      );

      expect(created.id).toBe('role-custom');
      expect(state.creates[0]).toEqual({
        name: 'custom',
        description: 'A custom role',
        isBuiltin: false,
        permissionIds: input.permissionIds,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
      expect(calls[0].actorAdminId).toBe('admin-1');
      expect(calls[0].subject).toBe('Role:role-custom');
      expect(calls[0].after).toEqual(input);
    });
  });

  describe('update', () => {
    it('throws BuiltinRoleImmutableError on a builtin role', async () => {
      const builtin: RoleWithPermissions = {
        id: 'role-super',
        name: 'super_admin',
        description: 'x',
        isBuiltin: true,
        permissionIds: [],
      };
      const { repo, state } = makeRepo({ byId: { 'role-super': builtin } });
      const { audit, calls } = makeAudit();

      await expect(
        new RoleService(repo, audit).update(
          'role-super',
          { description: 'no' },
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(BuiltinRoleImmutableError);

      expect(state.updates).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it('updates a custom role and audits with before/after', async () => {
      const custom: RoleWithPermissions = {
        id: 'role-custom',
        name: 'custom',
        description: 'old',
        isBuiltin: false,
        permissionIds: ['api_route:GET /admin/audit:read'],
      };
      const { repo, state } = makeRepo({ byId: { 'role-custom': custom } });
      const { audit, calls } = makeAudit();

      const input = {
        description: 'new',
        permissionIds: ['api_route:GET /admin/admins:read'],
      };
      await new RoleService(repo, audit).update(
        'role-custom',
        input,
        'admin-1',
      );

      expect(state.updates).toEqual([{ id: 'role-custom', input }]);
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
      expect(calls[0].subject).toBe('Role:role-custom');
      expect(calls[0].before).toEqual(custom);
      expect(calls[0].after).toEqual(input);
    });
  });
});
