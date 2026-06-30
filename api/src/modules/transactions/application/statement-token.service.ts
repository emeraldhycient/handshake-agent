import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { StatementConfig } from '../../../core/config/configuration';

/** Thrown when STATEMENT_SIGNING_KEY is unset — no link is ever issued unsigned. */
export class StatementNotSignableError extends Error {
  constructor() {
    super(
      'STATEMENT_SIGNING_KEY is not configured — cannot sign statement links',
    );
    this.name = 'StatementNotSignableError';
  }
}

/** Thrown for any malformed / tampered / expired token. */
export class StatementTokenInvalidError extends Error {
  constructor(reason: string) {
    super(`Statement token invalid: ${reason}`);
    this.name = 'StatementTokenInvalidError';
  }
}

export interface StatementTokenPayload {
  userId: string;
  from: string; // ISO 8601
  to: string;
  txType: string; // 'buy' | 'sell' | 'send' | 'receive' | 'all'
}

interface SignedPayload extends StatementTokenPayload {
  exp: number; // unix seconds
}

@Injectable()
export class StatementTokenService {
  constructor(
    // env-only reads (PUBLIC_API_BASE_URL, PORT, STATEMENT_SIGNING_KEY) stay on
    // the plain ConfigService — infra/secrets, NOT admin-tunable (root §7).
    private readonly config: ConfigService,
    // the `statement` section IS admin-tunable — read via EffectiveConfigService.
    private readonly effectiveConfig: EffectiveConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  sign(payload: StatementTokenPayload): string {
    const key = this.requireKey();
    const ttl =
      this.effectiveConfig.get<StatementConfig>('statement').linkTtlSeconds;
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttl;
    const body = Buffer.from(
      JSON.stringify({ ...payload, exp } satisfies SignedPayload),
    ).toString('base64url');
    return `${body}.${this.mac(body, key)}`;
  }

  verify(token: string): StatementTokenPayload {
    const key = this.requireKey();
    const dot = token.indexOf('.');
    if (dot <= 0) throw new StatementTokenInvalidError('malformed');
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.mac(body, key);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new StatementTokenInvalidError('bad signature');
    }
    let parsed: SignedPayload;
    try {
      parsed = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as SignedPayload;
    } catch {
      throw new StatementTokenInvalidError('unparseable');
    }
    if (parsed.exp * 1000 <= this.clock.now().getTime()) {
      throw new StatementTokenInvalidError('expired');
    }
    return {
      userId: parsed.userId,
      from: parsed.from,
      to: parsed.to,
      txType: parsed.txType,
    };
  }

  buildDownloadUrl(token: string): string {
    const base =
      this.config.get<string>('PUBLIC_API_BASE_URL') ??
      `http://localhost:${this.config.get<number>('PORT')}`;
    return `${base}/transactions/statement/download?token=${token}`;
  }

  private requireKey(): string {
    const key = this.config.get<string>('STATEMENT_SIGNING_KEY') ?? '';
    if (!key) throw new StatementNotSignableError();
    return key;
  }

  private mac(body: string, key: string): string {
    return createHmac('sha256', key).update(body).digest('hex');
  }
}
