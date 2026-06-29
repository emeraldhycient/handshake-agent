import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthService } from './application/auth.service';
import { TokenService } from './application/token.service';
import { AUTH_CHALLENGE_REPOSITORY } from './application/ports/auth-challenge.repository.port';
import { AUTH_SESSION_REPOSITORY } from './application/ports/auth-session.repository.port';
import { AUTH_USER_REPOSITORY } from './application/ports/auth-user.repository.port';
import {
  EMAIL_PROVIDER,
  type IEmailProvider,
} from './application/ports/email-provider.port';
import { AuthChallengePrismaRepository } from './infrastructure/auth-challenge.prisma.repository';
import { AuthSessionPrismaRepository } from './infrastructure/auth-session.prisma.repository';
import { AuthUserPrismaRepository } from './infrastructure/auth-user.prisma.repository';
import { MockEmailProvider } from './infrastructure/mock-email.provider';
import { ResendEmailProvider } from './infrastructure/resend-email.provider';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';

/**
 * Selects the active email adapter from the layered config.
 *
 *   RESEND_API_KEY present/non-empty → ResendEmailProvider (real delivery)
 *   RESEND_API_KEY absent/empty      → MockEmailProvider  (dev/test log-only)
 *
 * Default is mock (safe): only an explicit non-empty key activates real sends.
 * Exported so the binding decision can be unit-tested without booting the full DI graph.
 */
export function selectEmailProvider(
  mock: MockEmailProvider,
  real: ResendEmailProvider,
  config: ConfigService,
): IEmailProvider {
  const key = config.get<string>('RESEND_API_KEY');
  return key && key.length > 0 ? real : mock;
}

@Module({
  imports: [PrismaModule, HttpModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    MockEmailProvider,
    ResendEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: selectEmailProvider,
      inject: [MockEmailProvider, ResendEmailProvider, ConfigService],
    },
    {
      provide: AUTH_CHALLENGE_REPOSITORY,
      useClass: AuthChallengePrismaRepository,
    },
    { provide: AUTH_USER_REPOSITORY, useClass: AuthUserPrismaRepository },
    { provide: AUTH_SESSION_REPOSITORY, useClass: AuthSessionPrismaRepository },
  ],
  // Exported so later modules (web chat/exec) can apply JwtAuthGuard + resolve sessions.
  // AuthService is exported so the identity ProfileService can reuse its `me()` projection.
  exports: [JwtAuthGuard, TokenService, AUTH_SESSION_REPOSITORY, AuthService],
})
export class WebAuthModule {}
