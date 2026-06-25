import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { Request } from 'express';

import type { Env } from '../../../core/config/env.schema';

/**
 * Fail-closed Bearer-token guard for admin endpoints (WN-5 §4).
 *
 * Behaviour:
 *   - ADMIN_API_TOKEN not set (empty string / undefined) → every request is
 *     denied (403). The endpoint ships disabled and unexploitable by default.
 *   - ADMIN_API_TOKEN set and non-empty → Authorization header must equal
 *     `Bearer <token>`, compared with a constant-time equality check
 *     (timingSafeEqual over SHA-256 digests to prevent timing oracle attacks).
 *
 * Swap seam (admin UI → proper session auth):
 *   When the admin UI + admin-session auth is built, replace this guard with
 *   a `@UseGuards(AdminSessionGuard)` decorator on the controller (or use
 *   a module-level guard). The controller, DTO, and WalletBackfillService
 *   stay unchanged — only this guard is swapped.
 *
 *   Recommended migration path:
 *     1. Build AdminSessionGuard (JWT + admin role claim).
 *     2. Replace `AdminTokenGuard` in AdminModule providers and on the
 *        controller with the new guard.
 *     3. Remove ADMIN_API_TOKEN from env.schema once all callers are migrated.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  private readonly logger = new Logger(AdminTokenGuard.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredToken: string =
      this.config.get('ADMIN_API_TOKEN', { infer: true }) ?? '';

    // Fail-closed: if the token is not configured, deny all requests.
    if (!configuredToken) {
      this.logger.warn(
        'AdminTokenGuard: ADMIN_API_TOKEN is not set — request denied (fail-closed). ' +
          'Set ADMIN_API_TOKEN to enable admin endpoints.',
      );
      throw new ForbiddenException('Admin access not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ForbiddenException('Missing or malformed Authorization header');
    }

    const suppliedToken = authHeader.slice('Bearer '.length);

    // Constant-time comparison via SHA-256 digests — prevents timing oracle attacks
    // (timingSafeEqual requires equal-length buffers; hashing ensures that).
    const suppliedHash = createHash('sha256').update(suppliedToken).digest();
    const configuredHash = createHash('sha256')
      .update(configuredToken)
      .digest();

    const matches = timingSafeEqual(suppliedHash, configuredHash);

    if (!matches) {
      throw new ForbiddenException('Invalid admin token');
    }

    return true;
  }
}
