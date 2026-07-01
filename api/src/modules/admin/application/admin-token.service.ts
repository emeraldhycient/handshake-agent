import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AdminInvalidCredentialsError } from '../domain/admin-errors';
import type { Env } from '../../../core/config/env.schema';

/**
 * All admin session-token crypto: JWT sign/verify and SHA-256 hashing (sessions
 * store only the token hash, never the JWT). Distinct from the user TokenService
 * so an admin token can never be confused with a user token (separate secret).
 *
 * Fail-closed: an empty ADMIN_JWT_SECRET throws on sign — the app boots but admin
 * auth is disabled (mirrors the ADMIN_API_TOKEN pattern, root §7).
 */
@Injectable()
export class AdminTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private secret(): string {
    const secret = this.config.get('ADMIN_JWT_SECRET', { infer: true });
    if (!secret) throw new AdminInvalidCredentialsError();
    return secret;
  }

  sign(sessionId: string): { token: string; expiresAt: Date } {
    const secret = this.secret();
    const ttl = this.config.get('ADMIN_SESSION_TTL_SECONDS', { infer: true });
    const token = this.jwt.sign({ sub: sessionId }, { secret, expiresIn: ttl });
    return { token, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  verify(token: string): { sessionId: string } {
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.secret(),
      });
      return { sessionId: payload.sub };
    } catch {
      throw new AdminInvalidCredentialsError();
    }
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
