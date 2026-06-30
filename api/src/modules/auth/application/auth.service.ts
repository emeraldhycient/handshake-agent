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
  OtpLockedError,
  UserNotFoundError,
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

/**
 * Dummy hash used as the comparison target when loginVerify runs on an
 * unknown/unverified user path. It ensures every code path performs an
 * identical constantTimeEquals call so latency does not reveal whether an
 * email is registered or verified (timing/enumeration oracle defence).
 * Value is a fixed 64-char lowercase hex string (SHA-256 output length).
 */
const DUMMY_CHALLENGE_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000' as const;

/**
 * Throwaway UUID used as the userId argument when performing a dummy DB lookup
 * on the unknown-user path of loginVerify. The result is always null and is
 * discarded; the call exists solely to equalise DB round-trip latency.
 */
const DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000' as const;

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

  /**
   * Resends the login OTP. Functionally identical to {@link loginRequest} — the
   * upsert re-issues a fresh code while the challenge-repo carry-over policy
   * keeps the guess counter accumulating within the active window (C2 defence).
   * Exposed as a distinct verb so the FE has an explicit "resend code" action.
   */
  async resendLoginOtp(input: LoginRequest): Promise<LoginRequestResponse> {
    return this.loginRequest(input);
  }

  /**
   * Resends the email-verification link to an existing, NOT-yet-verified user.
   *
   * Neutral by design (no enumeration): always returns pending_verification and
   * only actually re-issues + sends when the email belongs to an existing user
   * who is not yet verified. Already-verified or unknown emails get the same
   * response with no email sent. Idempotent — re-issuing invalidates the prior
   * token (a fresh single-use token is minted each time).
   */
  async resendEmailVerification(input: LoginRequest): Promise<SignupResponse> {
    const user = await this.users.findByEmail(input.email);
    if (user !== null && user.emailVerifiedAt === null) {
      const token = this.tokens.generateOpaqueToken();
      const ttl =
        this.config.get<number>('auth.emailToken.ttlSeconds') ?? 86400;
      await this.challenges.upsert({
        userId: user.id,
        type: 'email_verification',
        challengeHash: this.tokens.hash(token),
        expiresAt: new Date(Date.now() + ttl * 1000),
      });
      await this.email.sendEmailVerification(user.email, token);
      if (this.devExpose()) {
        return { status: 'pending_verification', devToken: token };
      }
    }
    return { status: 'pending_verification' };
  }

  async loginVerify(
    input: LoginVerifyRequest & { userAgent?: string; ip?: string },
  ): Promise<LoginVerifyResponse> {
    const now = new Date();
    const user = await this.users.findByEmail(input.email);

    // Determine whether this is a valid, verified user. For unknown/unverified
    // users we still perform a challenge lookup and a constant-time compare so
    // that response latency does not leak whether the email is registered or
    // verified (timing oracle defence).
    const isRealUser = user !== null && user.emailVerifiedAt !== null;
    const lookupUserId = isRealUser ? user.id : DUMMY_USER_ID;

    const challenge = await this.challenges.findActiveByUserAndType(
      lookupUserId,
      'otp_email',
      now,
    );

    const maxAttempts = this.config.get<number>('auth.otp.maxAttempts') ?? 5;
    const storedHash = challenge?.challengeHash ?? DUMMY_CHALLENGE_HASH;
    const otpMatches = this.constantTimeEquals(
      this.tokens.hash(input.otp),
      storedHash,
    );

    // All rejection conditions: unknown/unverified user, no active challenge,
    // exhausted attempts, or wrong code. We gate the incrementAttempt call
    // inside the real-user + real-challenge + wrong-code branch only.
    //
    // Order matters for enumeration safety: the unknown/unverified path throws
    // the GENERIC InvalidOtpError FIRST, so the distinguishable OtpLockedError
    // below is only ever reachable for a real, verified user with a real active
    // challenge — telling that user to request a new code leaks nothing.
    if (!isRealUser) throw new InvalidOtpError();
    if (challenge === null) throw new InvalidOtpError();
    if (challenge.attemptCount >= maxAttempts) {
      // Distinct from a wrong code: the guess budget is spent. The FE routes
      // this to "request a new code" instead of looping a dead challenge.
      throw new OtpLockedError();
    }
    if (!otpMatches) {
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
    // A valid session whose user no longer exists is a missing account, not a
    // token failure — distinct error so the controller maps it to 404, never
    // 401 (which the web client would treat as expired and retry in a loop).
    if (me === null) throw new UserNotFoundError();
    return me;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
