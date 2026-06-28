import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AUTH_SESSION_REPOSITORY,
  type IAuthSessionRepository,
} from '../application/ports/auth-session.repository.port';
import { TokenService } from '../application/token.service';

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  deviceId: string | null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: IAuthSessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();

    let sub: string;
    try {
      ({ sub } = this.tokens.verifyAccessToken(token));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const session = await this.sessions.findActiveByAccessHash(
      this.tokens.hash(token),
      new Date(),
    );
    if (session === null || session.userId !== sub) {
      throw new UnauthorizedException('Session is not active');
    }

    req.user = {
      userId: session.userId,
      sessionId: session.id,
      deviceId: session.deviceId,
    };
    return true;
  }
}
