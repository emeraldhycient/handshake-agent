import { timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  LoginRequest,
  LoginRequestResponse,
  LoginVerifyRequest,
  LoginVerifyResponse,
  MeResponse,
  RefreshRequest,
  RefreshResponse,
  SignupRequest,
  SignupResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from '@handshake-agent/contracts';

import {
  InvalidOtpError,
  InvalidRefreshTokenError,
  InvalidVerificationTokenError,
} from '../domain/auth-errors';
import {
  AUTH_CHALLENGE_REPOSITORY,
  type IAuthChallengeRepository,
} from './ports/auth-challenge.repository.port';
import {
  AUTH_USER_REPOSITORY,
  type IAuthUserRepository,
} from './ports/auth-user.repository.port';
import {
  AUTH_SESSION_REPOSITORY,
  type IAuthSessionRepository,
} from './ports/auth-session.repository.port';
import {
  EMAIL_PROVIDER,
  type IEmailProvider,
} from './ports/email-provider.port';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    @Inject(EMAIL_PROVIDER) private readonly email: IEmailProvider,
    @Inject(AUTH_CHALLENGE_REPOSITORY)
    private readonly challenges: IAuthChallengeRepository,
    @Inject(AUTH_USER_REPOSITORY) private readonly users: IAuthUserRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: IAuthSessionRepository,
    private readonly config: ConfigService,
  ) {}

  private devExpose(): boolean {
    return this.config.get<string>('AUTH_DEV_EXPOSE_OTP') === 'true';
  }

  async signup(input: SignupRequest): Promise<SignupResponse> {
    const { userId } = await this.users.createSignup({
      email: input.email,
      phone: input.phone,
    });

    const token = this.tokens.generateOpaqueToken();
    const ttl = this.config.get<number>('auth.emailToken.ttlSeconds') ?? 86400;
    await this.challenges.upsert({
      userId,
      type: 'email_verification',
      challengeHash: this.tokens.hash(token),
      expiresAt: new Date(Date.now() + ttl * 1000),
    });

    await this.email.sendEmailVerification(input.email, token);

    return this.devExpose()
      ? { status: 'pending_verification', devToken: token }
      : { status: 'pending_verification' };
  }

  async verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse> {
    const now = new Date();
    const challenge = await this.challenges.findActiveByHashAndType(
      this.tokens.hash(input.token),
      'email_verification',
      now,
    );
    if (challenge === null) throw new InvalidVerificationTokenError();

    await this.challenges.consume(challenge.id, now);
    await this.users.markEmailVerified(challenge.userId, now);
    return { verified: true };
  }

  async loginRequest(input: LoginRequest): Promise<LoginRequestResponse> {
    const user = await this.users.findByEmail(input.email);
    // No enumeration: always return otp_sent; only actually send to verified users.
    if (user !== null && user.emailVerifiedAt !== null) {
      const length = this.config.get<number>('auth.otp.length') ?? 6;
      const ttl = this.config.get<number>('auth.otp.ttlSeconds') ?? 300;
      const otp = this.tokens.generateNumericOtp(length);
      await this.challenges.upsert({
        userId: user.id,
        type: 'otp_email',
        challengeHash: this.tokens.hash(otp),
        expiresAt: new Date(Date.now() + ttl * 1000),
      });
      await this.email.sendLoginOtp(user.email, otp);
      if (this.devExpose()) return { status: 'otp_sent', devOtp: otp };
    }
    return { status: 'otp_sent' };
  }

  async loginVerify(
    input: LoginVerifyRequest & { userAgent?: string; ip?: string },
  ): Promise<LoginVerifyResponse> {
    const now = new Date();
    const user = await this.users.findByEmail(input.email);
    if (user === null || user.emailVerifiedAt === null)
      throw new InvalidOtpError();

    const challenge = await this.challenges.findActiveByUserAndType(
      user.id,
      'otp_email',
      now,
    );
    const maxAttempts = this.config.get<number>('auth.otp.maxAttempts') ?? 5;
    if (challenge === null || challenge.attemptCount >= maxAttempts) {
      throw new InvalidOtpError();
    }

    if (
      !this.constantTimeEquals(
        this.tokens.hash(input.otp),
        challenge.challengeHash,
      )
    ) {
      await this.challenges.incrementAttempt(challenge.id);
      throw new InvalidOtpError();
    }

    await this.challenges.consume(challenge.id, now);
    const { deviceId } = await this.users.bindDevice({
      userId: user.id,
      fingerprint: input.deviceFingerprint,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    const accessToken = this.tokens.signAccessToken(user.id);
    const refreshToken = this.tokens.generateOpaqueToken();
    const refreshTtl =
      this.config.get<number>('auth.jwt.refreshTtlSeconds') ?? 2592000;
    await this.sessions.create({
      userId: user.id,
      deviceId,
      accessTokenHash: this.tokens.hash(accessToken),
      refreshTokenHash: this.tokens.hash(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    const me = await this.users.loadMe(user.id);
    return {
      accessToken,
      refreshToken,
      user: me as MeResponse,
    };
  }

  async refresh(input: RefreshRequest): Promise<RefreshResponse> {
    const now = new Date();
    const session = await this.sessions.findActiveByRefreshHash(
      this.tokens.hash(input.refreshToken),
      now,
    );
    if (session === null) throw new InvalidRefreshTokenError();

    const accessToken = this.tokens.signAccessToken(session.userId);
    const refreshToken = this.tokens.generateOpaqueToken();
    await this.sessions.rotate(session.id, {
      accessTokenHash: this.tokens.hash(accessToken),
      refreshTokenHash: this.tokens.hash(refreshToken),
      now,
    });
    return { accessToken, refreshToken };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, new Date());
  }

  async me(userId: string): Promise<MeResponse> {
    const me = await this.users.loadMe(userId);
    if (me === null) throw new InvalidRefreshTokenError();
    return me;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
