/**
 * PatAuthGuard — bearer auth for the machine/MCP surface (Wave C).
 *
 * Accepts ONLY `Authorization: Bearer hsk_pat_…` personal access tokens:
 *   - a session JWT (or anything without the PAT prefix) is rejected 401
 *     BEFORE any lookup — PATs and session JWTs are disjoint credentials;
 *   - the token is resolved by SHA-256 hash and must be unrevoked + unexpired;
 *   - on success `{ userId, patId, scopes }` is attached as `req.pat`
 *     (deliberately NOT `req.user` — a PAT principal must never satisfy
 *     JwtAuthGuard-protected session endpoints);
 *   - lastUsedAt is bumped fire-and-forget (telemetry must never block auth).
 *
 * This guard is NOT wired into JwtAuthGuard or any global guard — it is
 * applied explicitly on PAT-only surfaces (the MCP module).
 */

import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import { PAT_TOKEN_PREFIX } from '@handshake-agent/contracts';

import { sha256Hex } from '../../../core/crypto/hmac';
import {
  PAT_REPOSITORY,
  type IPatRepository,
} from '../application/ports/pat.repository.port';

/** The authenticated PAT principal attached to the request as `req.pat`. */
export interface PatPrincipal {
  userId: string;
  patId: string;
  scopes: string[];
}

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class PatAuthGuard implements CanActivate {
  private readonly logger = new Logger(PatAuthGuard.name);

  constructor(
    @Inject(PAT_REPOSITORY) private readonly patRepo: IPatRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      pat?: PatPrincipal;
    }>();

    const header = req.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(BEARER_PREFIX.length).trim();

    // Only PATs pass here — a session JWT fails closed without a DB round-trip.
    if (!token.startsWith(PAT_TOKEN_PREFIX)) {
      throw new UnauthorizedException('A personal access token is required');
    }

    const now = new Date();
    const principal = await this.patRepo.findActiveByTokenHash(
      sha256Hex(token),
      now,
    );
    if (principal === null) {
      // Unknown, revoked and expired are indistinguishable to the caller.
      throw new UnauthorizedException('Invalid or expired token');
    }

    req.pat = {
      userId: principal.userId,
      patId: principal.patId,
      scopes: principal.scopes,
    };

    // Fire-and-forget usage telemetry — never awaited, never blocks auth.
    void this.patRepo.touchLastUsed(principal.patId, now).catch((err) => {
      this.logger.debug(
        `lastUsedAt touch failed for PAT ${principal.patId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return true;
  }
}

/** Param decorator: injects the PatPrincipal set by PatAuthGuard. */
export const CurrentPat = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PatPrincipal => {
    const req = ctx.switchToHttp().getRequest<{ pat: PatPrincipal }>();
    return req.pat;
  },
);
