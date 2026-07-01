import { AuthorizationService } from './authorization.service';
import type {
  IRoleRepository,
  RoleWithPermissions,
} from './ports/role.repository.port';
import type {
  IPermissionRepository,
  PermissionRecord,
} from './ports/permission.repository.port';

const CATALOG: PermissionRecord[] = [
  {
    id: 'p1',
    resourceType: 'api_route',
    resourceId: 'GET /admin/admins',
    action: 'read',
    category: 'Access',
    description: '',
  },
  {
    id: 'p2',
    resourceType: 'api_route',
    resourceId: 'POST /admin/roles',
    action: 'write',
    category: 'Access',
    description: '',
  },
  {
    id: 'p3',
    resourceType: 'api_route',
    resourceId: 'GET /admin/audit',
    action: 'read',
    category: 'Audit',
    description: '',
  },
  {
    id: 'p4',
    resourceType: 'menu_item',
    resourceId: 'menu.audit',
    action: 'read',
    category: 'Audit',
    description: '',
  },
  {
    id: 'p5',
    resourceType: 'web_page',
    resourceId: '/admin/audit',
    action: 'read',
    category: 'Audit',
    description: '',
  },
];

function build(
  roles: Record<string, RoleWithPermissions | null>,
): AuthorizationService {
  const roleRepo: IRoleRepository = {
    findById: (id) => Promise.resolve(roles[id] ?? null),
    create: () => Promise.reject(new Error('nyi')),
    findByName: () => Promise.resolve(null),
    list: () =>
      Promise.resolve(
        Object.values(roles).filter(Boolean) as RoleWithPermissions[],
      ),
    update: () => Promise.resolve(),
    countAdmins: () => Promise.resolve(0),
  };
  const permRepo: IPermissionRepository = {
    upsertCatalog: () => Promise.resolve(),
    list: () => Promise.resolve(CATALOG),
    findByRole: () => Promise.resolve([]),
  };
  return new AuthorizationService(roleRepo, permRepo);
}

const superAdmin: RoleWithPermissions = {
  id: 'r-super',
  name: 'super_admin',
  description: '',
  isBuiltin: true,
  permissionIds: [],
};
const auditor: RoleWithPermissions = {
  id: 'r-aud',
  name: 'compliance',
  description: '',
  isBuiltin: true,
  permissionIds: [
    'api_route:GET /admin/audit:read',
    'menu_item:menu.audit:read',
    'web_page:/admin/audit:read',
  ],
};

describe('AuthorizationService', () => {
  it('grants super_admin any permission without an explicit assignment', async () => {
    const svc = build({ 'r-super': superAdmin });
    expect(
      await svc.can('r-super', {
        resourceType: 'api_route',
        resourceId: 'POST /admin/roles',
        action: 'write',
      }),
    ).toBe(true);
  });

  it('grants a non-super role only its assigned permissions (default-deny)', async () => {
    const svc = build({ 'r-aud': auditor });
    expect(
      await svc.can('r-aud', {
        resourceType: 'api_route',
        resourceId: 'GET /admin/audit',
        action: 'read',
      }),
    ).toBe(true);
    expect(
      await svc.can('r-aud', {
        resourceType: 'api_route',
        resourceId: 'POST /admin/roles',
        action: 'write',
      }),
    ).toBe(false);
  });

  it('denies an unknown role', async () => {
    const svc = build({});
    expect(
      await svc.can('nope', {
        resourceType: 'api_route',
        resourceId: 'GET /admin/audit',
        action: 'read',
      }),
    ).toBe(false);
  });

  it('meView for super_admin returns the full catalog split by resource type', async () => {
    const svc = build({ 'r-super': superAdmin });
    const view = await svc.meView('r-super');
    expect(view.permissions).toContain('api_route:POST /admin/roles:write');
    expect(view.menus).toEqual(['menu.audit']);
    expect(view.pages).toEqual(['/admin/audit']);
  });

  it('meView for a non-super role returns only its grants', async () => {
    const svc = build({ 'r-aud': auditor });
    const view = await svc.meView('r-aud');
    expect(view.permissions).toEqual(auditor.permissionIds);
    expect(view.menus).toEqual(['menu.audit']);
    expect(view.pages).toEqual(['/admin/audit']);
    expect(view.permissions).not.toContain('api_route:POST /admin/roles:write');
  });
});
