/**
 * Bull Board Basic-auth middleware (BQ-1, fail-closed).
 *
 * Protects /admin/queues (the Bull Board dashboard) with HTTP Basic auth.
 * Password = ADMIN_API_TOKEN; username is arbitrary (use anything, e.g. "admin").
 *
 * Fail-closed:
 *   - ADMIN_API_TOKEN unset / empty → every request is denied with 401 + a
 *     WWW-Authenticate challenge. The dashboard ships disabled by default —
 *     the same principle as AdminTokenGuard on the REST admin endpoints.
 *   - ADMIN_API_TOKEN set and non-empty → credential (username:password) must
 *     arrive in a valid Base64-encoded Authorization: Basic … header with the
 *     correct password.
 *
 * Swap seam (admin UI):
 *   When the admin UI + proper admin-session auth lands, replace this middleware
 *   in the BullBoardModule forRoot options with the session-based middleware.
 *   The registered queues, route, and board options stay unchanged.
 *
 * NOTE: this is plain Express middleware (req, res, next) so it can be passed
 * directly to BullBoardModule.forRoot({ middleware: BullBoardBasicAuthMiddleware }).
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';

import type { Env } from '../../core/config/env.schema';

@Injectable()
export class BullBoardBasicAuthMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService<Env, true>) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const configuredToken: string =
      this.config.get('ADMIN_API_TOKEN', { infer: true }) ?? '';

    // Fail-closed: deny when the token is not configured.
    if (!configuredToken) {
      res.setHeader(
        'WWW-Authenticate',
        'Basic realm="Bull Board — Admin access not configured"',
      );
      res
        .status(401)
        .json({ message: 'Bull Board admin access not configured' });
      return;
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const encoded = authHeader.slice('Basic '.length);
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    // username:password — we only check the password; username is arbitrary.
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const suppliedPassword = decoded.slice(colonIdx + 1);

    // Constant-time comparison to prevent timing oracle attacks (same approach
    // as AdminTokenGuard — hash both sides to equalise length, then compare).
    const suppliedHash = createHash('sha256').update(suppliedPassword).digest();
    const configuredHash = createHash('sha256')
      .update(configuredToken)
      .digest();

    if (!timingSafeEqual(suppliedHash, configuredHash)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    next();
  }
}
