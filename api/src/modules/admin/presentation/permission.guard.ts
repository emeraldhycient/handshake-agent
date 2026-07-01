import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  AuthorizationService,
  type RequiredPermission,
} from '../application/authorization.service';
import { ADMIN_PERMISSION_KEY } from './require-permission.decorator';
import type { AdminContext } from './current-admin.decorator';

/**
 * Default-deny RBAC gate. A route MUST declare its required permission via
 * @RequirePermission; a route with no declaration is forbidden (fail-closed,
 * §3.3). Runs after AdminSessionGuard, which populates `req.admin`.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(ADMIN_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!required) {
      throw new ForbiddenException('No permission declared for this route');
    }

    const req = context.switchToHttp().getRequest<{ admin: AdminContext }>();
    const granted = await this.authz.can(req.admin.roleId, required);
    if (!granted) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
