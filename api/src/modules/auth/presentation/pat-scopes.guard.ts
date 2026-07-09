/**
 * RequirePatScopes + PatScopesGuard — scope enforcement for PAT surfaces.
 *
 * Usage (always AFTER PatAuthGuard, which attaches `req.pat`):
 *
 *   @UseGuards(PatAuthGuard, PatScopesGuard)
 *   @RequirePatScopes('chat:propose')
 *   @Post('…')
 *
 * Fail-closed: a handler that declares scopes but has no PAT principal on the
 * request (guard misordering / missing PatAuthGuard) is rejected 403.
 * A handler that declares NO scopes passes through — authentication alone
 * (PatAuthGuard) is its gate.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { PatScope } from '@handshake-agent/contracts';

import type { PatPrincipal } from './pat-auth.guard';

export const PAT_SCOPES_KEY = 'pat:requiredScopes';

/** Declares the PAT scopes a handler (or controller) requires. */
export const RequirePatScopes = (...scopes: PatScope[]) =>
  SetMetadata(PAT_SCOPES_KEY, scopes);

@Injectable()
export class PatScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  // Async for interface symmetry with PatAuthGuard (they are always paired).
  // eslint-disable-next-line @typescript-eslint/require-await
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<PatScope[] | undefined>(PAT_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ pat?: PatPrincipal }>();
    const pat = req.pat;
    if (!pat) {
      // Misordered guards / no PAT auth ran — fail closed, never fail open.
      throw new ForbiddenException('Scope check requires PAT authentication');
    }

    const missing = required.filter((scope) => !pat.scopes.includes(scope));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Token is missing required scope(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
