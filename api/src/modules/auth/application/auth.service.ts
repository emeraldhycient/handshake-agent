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
  SignupVerifyRequest,
  SignupVerifyResponse,
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
    // Also grants kycTier=tier_1 + status=active, guarded to unverified users
    // only (Task 2.1) — see the port/repo for the promotion + no-downgrade
    // details.
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

    await this.validateAndConsumeOtp(isRealUser, lookupUserId, input.otp, now);

    // isRealUser guaranteed true here (validateAndConsumeOtp throws otherwise),
    // so user is guaranteed non-null.
    return this.issueSession(user!.id, {
      fingerprint: input.deviceFingerprint,
      userAgent: input.userAgent,
      ip: input.ip,
    });
  }

  /**
   * OTP signup — additive counterpart to {@link signup}/{@link verifyEmail}
   * (Task 2.2). Creates-or-resumes the provisional user via
   * `createSignup({ email })` and mints+sends an OTP using the SAME
   * `otp_email` challenge mechanics as {@link loginRequest} (length/TTL/attempt
   * budget, single-active-challenge-per-user upsert).
   *
   * An already-**verified** email returns the identical `otp_sent` shape (no
   * enumeration) but deliberately mints NO challenge — it sends a "log in
   * instead" notice. This is more than a UX nicety: {@link signupVerify}'s
   * eligibility gate can only stay structurally airtight against OtpLockedError
   * leaking "is this email already verified?" if no real signup challenge ever
   * exists for a verified email (see signupVerify's doc comment).
   */
  async signupRequest(input: LoginRequest): Promise<LoginRequestResponse> {
    const existing = await this.users.findByEmail(input.email);
    if (existing !== null && existing.emailVerifiedAt !== null) {
      await this.email.sendLoginInstead(existing.email);
      return { status: 'otp_sent' };
    }

    const { userId } = await this.users.createSignup({ email: input.email });

    const length = this.config.get<number>('auth.otp.length') ?? 6;
    const ttl = this.config.get<number>('auth.otp.ttlSeconds') ?? 300;
    const otp = this.tokens.generateNumericOtp(length);
    await this.challenges.upsert({
      userId,
      type: 'otp_email',
      challengeHash: this.tokens.hash(otp),
      expiresAt: new Date(Date.now() + ttl * 1000),
    });
    await this.email.sendLoginOtp(input.email, otp);

    return this.devExpose()
      ? { status: 'otp_sent', devOtp: otp }
      : { status: 'otp_sent' };
  }

  /**
   * OTP signup verification (Task 2.2). Validates the OTP via the same
   * `otp_email` challenge as {@link loginVerify}, then — unlike login — this
   * call is what PERFORMS the verification: it calls
   * {@link IAuthUserRepository.markEmailVerified} (grants tier_1 + active,
   * Task 2.1) before binding the device and issuing the session.
   *
   * Eligibility is the MIRROR IMAGE of loginVerify's: a real user who is
   * **not yet** verified (loginVerify requires the opposite). Gating on this —
   * not just "the user exists" — keeps OtpLockedError structurally unreachable
   * for an already-verified email, even if that email happens to have an
   * unrelated active login-OTP challenge in flight; {@link signupRequest}
   * never mints a challenge for a verified email, so an ineligible caller is
   * rejected with the generic InvalidOtpError before the attempt-cap check is
   * ever reached — same anti-enumeration shape as loginVerify's unknown-user
   * path.
   */
  async signupVerify(
    input: SignupVerifyRequest & { userAgent?: string; ip?: string },
  ): Promise<SignupVerifyResponse> {
    const now = new Date();
    const user = await this.users.findByEmail(input.email);

    const isEligible = user !== null && user.emailVerifiedAt === null;
    const lookupUserId = isEligible ? user.id : DUMMY_USER_ID;

    await this.validateAndConsumeOtp(isEligible, lookupUserId, input.otp, now);

    // isEligible guaranteed true here, so user is guaranteed non-null.
    await this.users.markEmailVerified(user!.id, now);
    const session = await this.issueSession(user!.id, {
      fingerprint: input.deviceFingerprint,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    // markEmailVerified above guarantees this by the time we get here.
    // MeProjection/loadMe don't carry emailVerifiedAt (that's Task 4.1
    // territory) so it is set explicitly here rather than widening that port
    // for this one call site.
    return {
      ...session,
      user: { ...session.user, emailVerified: true },
    };
  }

  /**
   * Validates a numeric OTP challenge for (lookupUserId, 'otp_email') and
   * consumes it on success. Shared tail of {@link loginVerify} and
   * {@link signupVerify} — each caller computes its own eligibility gate (they
   * are opposite: login requires an already-verified user, signup requires an
   * unverified one) and passes DUMMY_USER_ID instead of a real id when
   * ineligible, so the DB round-trip (and therefore response timing) is
   * identical to the real-user path regardless of outcome (timing oracle
   * defence — same purpose as DUMMY_CHALLENGE_HASH above).
   *
   * Throws {@link InvalidOtpError} (ineligible caller, no active challenge, or
   * wrong code) or {@link OtpLockedError} (guess budget exhausted); resolves
   * with no value when the code is correct, immediately after consuming the
   * challenge.
   */
  private async validateAndConsumeOtp(
    isEligible: boolean,
    lookupUserId: string,
    otp: string,
    now: Date,
  ): Promise<void> {
    const challenge = await this.challenges.findActiveByUserAndType(
      lookupUserId,
      'otp_email',
      now,
    );

    const maxAttempts = this.config.get<number>('auth.otp.maxAttempts') ?? 5;
    const storedHash = challenge?.challengeHash ?? DUMMY_CHALLENGE_HASH;
    const otpMatches = this.constantTimeEquals(
      this.tokens.hash(otp),
      storedHash,
    );

    // Order matters for enumeration safety: the ineligible-caller path throws
    // the GENERIC InvalidOtpError FIRST, so the distinguishable OtpLockedError
    // below is only ever reachable for an eligible caller with a real active
    // challenge — telling that caller to request a new code leaks nothing.
    if (!isEligible) throw new InvalidOtpError();
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
  }

  /**
   * Binds the device, signs a fresh access/refresh pair, and persists the
   * session — the common tail of {@link loginVerify} and {@link signupVerify}
   * once the OTP has been validated and consumed.
   */
  private async issueSession(
    userId: string,
    device: { fingerprint: string; userAgent?: string; ip?: string },
  ): Promise<LoginVerifyResponse> {
    const { deviceId } = await this.users.bindDevice({
      userId,
      fingerprint: device.fingerprint,
      userAgent: device.userAgent,
      ip: device.ip,
    });

    const accessToken = this.tokens.signAccessToken(userId);
    const refreshToken = this.tokens.generateOpaqueToken();
    const refreshTtl =
      this.config.get<number>('auth.jwt.refreshTtlSeconds') ?? 2592000;
    await this.sessions.create({
      userId,
      deviceId,
      accessTokenHash: this.tokens.hash(accessToken),
      refreshTokenHash: this.tokens.hash(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    const me = await this.users.loadMe(userId);
    return {
      accessToken,
      refreshToken,
      user: me as MeResponse,
    };
  }

  async refresh(input: RefreshRequest): Promise<RefreshResponse> {
    // Cookie-primary (Wave H): the controller passes the token from the
    // ha_refresh cookie, or the optional body token, or neither. No token at all
    // is an authentication failure, not a validation error (→ 401 via the guard).
    if (!input.refreshToken) throw new InvalidRefreshTokenError();

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

    // Return the user projection so the web FE boot-rehydrates in one round-trip
    // (cookie → access token + identity). A live session whose user is gone is
    // treated as an invalid token (force re-login), never a partial response.
    const me = await this.users.loadMe(session.userId);
    if (me === null) throw new InvalidRefreshTokenError();
    return { accessToken, refreshToken, user: me };
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
