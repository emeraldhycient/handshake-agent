import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

import type { ITotpProvider } from '../application/ports/totp.port';

// otplib v12 (pinned): plain CommonJS, so it loads under the Nest CJS build AND
// the ts-jest test runtime. v13 is ESM-first (@scure/base) and fails to load
// under ts-jest, which would crash any e2e that boots the admin module — see
// CLAUDE.md §6/§12 on ESM-under-CJS friction.
const ISSUER = 'Handshake Admin';

@Injectable()
export class OtplibTotpAdapter implements ITotpProvider {
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(email: string, secret: string): string {
    return authenticator.keyuri(email, ISSUER, secret);
  }

  verify(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }
}
