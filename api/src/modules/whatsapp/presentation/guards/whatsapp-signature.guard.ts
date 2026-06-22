import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../../../../core/config/env.schema';
import { verifyHmacHeader } from '../../../../core/crypto/hmac';

/**
 * Verifies inbound WhatsApp webhook authenticity via `X-Hub-Signature-256`.
 *
 * Meta signs the raw request body bytes with HMAC-SHA256 keyed by the Meta
 * App Secret and places the result in the header as `sha256=<lowercasehex>`.
 * This guard performs a constant-time comparison (via `crypto.timingSafeEqual`
 * inside `verifyHmacHeader`) to avoid timing-oracle attacks.
 *
 * Raw-body requirement: the app must be created with `{ rawBody: true }` so
 * Express exposes `req.rawBody` — see `main.ts`. Re-serialising the parsed
 * JSON body would break verification (key order / whitespace may differ).
 *
 * Empty-secret dev path: if `WHATSAPP_APP_SECRET` is absent the operator
 * hasn't configured it yet. In non-production we allow the request (flagged
 * with a loud warning); in production we fail closed (§3.3).
 */
@Injectable()
export class WhatsAppSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsAppSignatureGuard.name);

  constructor(private readonly configService: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const appSecret = this.configService.get('WHATSAPP_APP_SECRET', {
      infer: true,
    });
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });

    // --- Empty-secret path (operator hasn't set the secret yet) ---
    if (!appSecret) {
      if (nodeEnv !== 'production') {
        // Loud warning so it's visible in dev logs (root CLAUDE.md §3.6: no silent paths).
        this.logger.warn(
          'WHATSAPP_APP_SECRET is not set — skipping signature verification. ' +
            'Set the secret before deploying to production.',
        );
        return Promise.resolve(true);
      }
      // Production: fail closed — an unconfigured secret is a misconfiguration.
      return Promise.reject(
        new UnauthorizedException(
          'Webhook signature verification is not configured',
        ),
      );
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();

    // `req.rawBody` is only present when the app is bootstrapped with
    // `{ rawBody: true }`. If it's missing we cannot verify — reject.
    if (!req.rawBody) {
      return Promise.reject(
        new UnauthorizedException(
          'Raw body unavailable — cannot verify webhook signature',
        ),
      );
    }

    const header = req.headers['x-hub-signature-256'] as string | undefined;

    const valid = verifyHmacHeader('sha256', appSecret, req.rawBody, header);
    if (!valid) {
      return Promise.reject(
        new UnauthorizedException('Invalid webhook signature'),
      );
    }

    return Promise.resolve(true);
  }
}
