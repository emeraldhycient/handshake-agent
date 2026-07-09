import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { ADMIN_SESSION_COOKIE } from '../../../core/common/cookie-options';
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
 * Authenticates an admin request: validates the session JWT, binds it to an
 * active session row (token.sub === session.id AND hash(token) matches the
 * stored hash), confirms the admin is still active, and attaches the principal
 * as `req.admin`. Any failure is an opaque UnauthorizedException — no detail
 * leaks why (mirrors the user-side JwtAuthGuard).
 *
 * The token is read COOKIE-OR-HEADER (Wave H): the browser sends it in the
 * HttpOnly `ha_admin_session` cookie (preferred), while non-browser / e2e callers
 * may still send `Authorization: Bearer <jwt>`. The cookie wins when both exist.
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
      cookies?: Record<string, string | undefined>;
      admin?: AdminContext;
    }>();

    const token = this.extractToken(req);
    if (token === null) {
      throw new UnauthorizedException('Missing bearer token');
    }

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

  /**
   * Extracts the session JWT cookie-first, header-second. Returns null when
   * neither carries a usable token (→ opaque 401).
   */
  private extractToken(req: {
    headers: Record<string, string | undefined>;
    cookies?: Record<string, string | undefined>;
  }): string | null {
    const cookieToken = req.cookies?.[ADMIN_SESSION_COOKIE];
    if (cookieToken) return cookieToken;

    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }
    return null;
  }
}
