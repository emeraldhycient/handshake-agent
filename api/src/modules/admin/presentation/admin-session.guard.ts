import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AdminTokenService } from '../application/admin-token.service';
import {
  ADMIN_SESSION_REPOSITORY,
  type IAdminSessionRepository,
} from '../application/ports/admin-session.repository.port';
import {
  ADMIN_USER_REPOSITORY,
  type IAdminUserRepository,
} from '../application/ports/admin-user.repository.port';
import type { AdminContext } from './current-admin.decorator';

/**
 * Authenticates an admin request: validates the Bearer JWT, binds it to an
 * active session row (token.sub === session.id AND hash(token) matches the
 * stored hash), confirms the admin is still active, and attaches the principal
 * as `req.admin`. Any failure is an opaque UnauthorizedException — no detail
 * leaks why (mirrors the user-side JwtAuthGuard).
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly tokens: AdminTokenService,
    @Inject(ADMIN_SESSION_REPOSITORY)
    private readonly sessions: IAdminSessionRepository,
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly users: IAdminUserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      admin?: AdminContext;
    }>();

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();

    let sessionId: string;
    try {
      ({ sessionId } = this.tokens.verify(token));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const session = await this.sessions.findActiveByTokenHash(
      this.tokens.hash(token),
      new Date(),
    );
    if (session === null || session.id !== sessionId) {
      throw new UnauthorizedException('Session is not active');
    }

    const user = await this.users.findById(session.adminUserId);
    if (user === null || user.status !== 'active') {
      throw new UnauthorizedException('Admin is not active');
    }

    req.admin = {
      adminId: user.id,
      sessionId: session.id,
      roleId: user.roleId,
      email: user.email,
    };
    return true;
  }
}
