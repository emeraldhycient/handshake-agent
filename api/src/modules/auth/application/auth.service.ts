import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  SignupRequest,
  SignupResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from '@handshake-agent/contracts';

import { InvalidVerificationTokenError } from '../domain/auth-errors';
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
}
