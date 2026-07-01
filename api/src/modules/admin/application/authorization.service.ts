import { Inject, Injectable } from '@nestjs/common';

import { permissionId } from '@handshake-agent/contracts';

import {
  ROLE_REPOSITORY,
  type IRoleRepository,
  type RoleWithPermissions,
} from './ports/role.repository.port';
import {
  PERMISSION_REPOSITORY,
  type IPermissionRepository,
} from './ports/permission.repository.port';

export interface RequiredPermission {
  resourceType: string;
  resourceId: string;
  action: string;
}

export interface AdminMeView {
  /** Canonical permission-id strings the admin holds. */
  permissions: string[];
  /** menu_item resourceIds (nav groups) the admin may see. */
  menus: string[];
  /** web_page resourceIds the admin may open. */
  pages: string[];
}

// RBAC resolution. Default-deny: an unknown role, or a permission not in the
// role's grant set, is denied. The built-in `super_admin` role short-circuits to
// allow-all so it is never locked out of a newly-registered capability.
@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roles: IRoleRepository,
    @Inject(PERMISSION_REPOSITORY)
    private readonly permissions: IPermissionRepository,
  ) {}

  async can(roleId: string, required: RequiredPermission): Promise<boolean> {
    const role = await this.roles.findById(roleId);
    if (!role) return false;
    if (isSuperAdmin(role)) return true;
    return new Set(role.permissionIds).has(permissionId(required));
  }

  async effectivePermissionIds(roleId: string): Promise<Set<string>> {
    const role = await this.roles.findById(roleId);
    if (!role) return new Set();
    if (isSuperAdmin(role)) {
      const all = await this.permissions.list();
      return new Set(all.map((p) => permissionId(p)));
    }
    return new Set(role.permissionIds);
  }

  async meView(roleId: string): Promise<AdminMeView> {
    const ids = [...(await this.effectivePermissionIds(roleId))];
    const menus: string[] = [];
    const pages: string[] = [];
    for (const id of ids) {
      const parsed = parsePermissionId(id);
      if (parsed.resourceType === 'menu_item') menus.push(parsed.resourceId);
      else if (parsed.resourceType === 'web_page')
        pages.push(parsed.resourceId);
    }
    return { permissions: ids, menus, pages };
  }
}

function isSuperAdmin(role: RoleWithPermissions): boolean {
  return role.isBuiltin && role.name === 'super_admin';
}

// Permission ids are `${resourceType}:${resourceId}:${action}`. resourceId may
// itself contain no colon today, but split on the first/last colon to be safe.
function parsePermissionId(id: string): RequiredPermission {
  const first = id.indexOf(':');
  const last = id.lastIndexOf(':');
  return {
    resourceType: id.slice(0, first),
    resourceId: id.slice(first + 1, last),
    action: id.slice(last + 1),
  };
}
