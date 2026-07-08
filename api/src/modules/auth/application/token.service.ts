import { createHash, randomBytes, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { TokenSigningDisabledError } from '../domain/auth-errors';

/**
 * All token crypto for the auth module: access-JWT sign/verify, opaque refresh
 * tokens, SHA-256 hashing (for storing token/OTP hashes), and numeric OTPs.
 *
 * Fail-closed: if JWT_SECRET is empty, signing/verifying throw — the app boots
 * but auth is disabled (mirrors the ADMIN_API_TOKEN pattern, root §7).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private secret(): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    if (secret === '') throw new TokenSigningDisabledError();
    return secret;
  }

  signAccessToken(userId: string): string {
    const ttl = this.config.get<number>('auth.jwt.accessTtlSeconds') ?? 3600;
    return this.jwt.sign(
      { sub: userId },
      { secret: this.secret(), expiresIn: ttl },
    );
  }

  verifyAccessToken(token: string): { sub: string } {
    const payload = this.jwt.verify<{ sub: string }>(token, {
      secret: this.secret(),
      // Pin the algorithm: sign() uses HS256 (jsonwebtoken default), so verify
      // must accept HS256 ONLY — an unpinned verify accepts any HMAC alg.
      algorithms: ['HS256'],
    });
    return { sub: payload.sub };
  }

  generateOpaqueToken(): string {
    return randomBytes(32).toString('hex');
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  generateNumericOtp(length: number): string {
    let otp = '';
    for (let i = 0; i < length; i += 1) otp += randomInt(0, 10).toString();
    return otp;
  }
}
