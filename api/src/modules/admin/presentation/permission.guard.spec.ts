import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PermissionGuard } from './permission.guard';
import type { AdminContext } from './current-admin.decorator';
import type { AuthorizationService } from '../application/authorization.service';

const admin: AdminContext = {
  adminId: 'admin-1',
  sessionId: 'sess-1',
  roleId: 'role-1',
  email: 'admin@x.io',
};

const META = {
  resourceType: 'api_route',
  resourceId: 'GET /admin/audit',
  action: 'read',
};

function ctx(): ExecutionContext {
  const req = { admin };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function build(meta: typeof META | undefined, can: boolean) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(meta),
  } as unknown as jest.Mocked<Reflector>;
  const authz = {
    can: jest.fn().mockResolvedValue(can),
  } as unknown as jest.Mocked<AuthorizationService>;
  return { guard: new PermissionGuard(reflector, authz), authz };
}

describe('PermissionGuard', () => {
  it('allows the request when the role holds the required permission', async () => {
    const { guard, authz } = build(META, true);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(authz.can).toHaveBeenCalledWith('role-1', META);
  });

  it('throws Forbidden when the role lacks the required permission', async () => {
    const { guard } = build(META, false);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws Forbidden (fail-closed) when no permission metadata is declared', async () => {
    const { guard, authz } = build(undefined, true);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(authz.can).not.toHaveBeenCalled();
  });
});
