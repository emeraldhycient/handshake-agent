import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthService } from './application/auth.service';
import { TokenService } from './application/token.service';
import { AUTH_CHALLENGE_REPOSITORY } from './application/ports/auth-challenge.repository.port';
import { AUTH_SESSION_REPOSITORY } from './application/ports/auth-session.repository.port';
import { AUTH_USER_REPOSITORY } from './application/ports/auth-user.repository.port';
import { EMAIL_PROVIDER } from './application/ports/email-provider.port';
import { AuthChallengePrismaRepository } from './infrastructure/auth-challenge.prisma.repository';
import { AuthSessionPrismaRepository } from './infrastructure/auth-session.prisma.repository';
import { AuthUserPrismaRepository } from './infrastructure/auth-user.prisma.repository';
import { MockEmailProvider } from './infrastructure/mock-email.provider';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    { provide: EMAIL_PROVIDER, useClass: MockEmailProvider },
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
