import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../../core/auth/auth.module';
import { WebAuthModule } from '../auth/auth.module';
import { CLOCK, SystemClock } from '../../core/common/clock';
import { IDENTITY_REPOSITORY } from './application/ports/identity.repository.port';
import { VELOCITY_REPOSITORY } from './application/ports/velocity.repository.port';
import {
  KYC_PROVIDER,
  type IKycProvider,
} from './application/ports/kyc-provider.port';
import { KYC_REPOSITORY } from './application/ports/kyc.repository.port';
import { USER_LISTER } from '../wallets/application/ports/user-lister.port';
import { IdentityService } from './application/identity.service';
import { KycGateService } from './application/kyc-gate.service';
import { KycService } from './application/kyc.service';
import { PinSetupService } from './application/pin-setup.service';
import { IdentityPrismaRepository } from './infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from './infrastructure/velocity.prisma.repository';
import { KycPrismaRepository } from './infrastructure/kyc.prisma.repository';
import { ActiveUserListerPrismaAdapter } from './infrastructure/active-user-lister.prisma';
import { ProfileSessionPrismaRepository } from './infrastructure/profile-session.prisma.repository';
import { MockKycProvider } from './infrastructure/mock-kyc.provider';
import { SumsubKycProvider } from './infrastructure/sumsub-kyc.provider';
import { KycController } from './presentation/kyc.controller';
import { ProfileService } from './application/profile.service';
import { ProfileSettingsService } from './application/profile-settings.service';
import { PROFILE_SESSION_REPOSITORY } from './application/ports/profile-session.repository.port';
import { ProfileController } from './presentation/profile.controller';

/**
 * Selects the active KYC adapter from the layered config.
 *
 *   KYC_MOCK_MODE=true  (env-schema default) → MockKycProvider
 *   KYC_MOCK_MODE=false                       → SumsubKycProvider (live)
 *
 * Default is mock (safe): only an explicit 'false' activates real Sumsub
 * calls. Mirrors selectWalletProvider / selectPaymentProvider / selectSwapProvider
 * (WalletsModule / TreasuryModule). Exported so the binding decision can be
 * unit-tested without booting the full DI graph (task 3.3).
 */
export function selectKycProvider(
  mock: MockKycProvider,
  real: SumsubKycProvider,
  config: ConfigService,
): IKycProvider {
  return config.get<string>('KYC_MOCK_MODE') === 'false' ? real : mock;
}

/**
 * Identity feature module. PrismaModule is global, so PrismaService is already
 * available in the DI container without importing it here. ConfigModule is
 * global (see AppModule), so ConfigService is also available without import.
 *
 * KYC_PROVIDER is bound via `selectKycProvider`: MockKycProvider by default,
 * or the real SumsubKycProvider when KYC_MOCK_MODE=false (task 3.3 — same
 * isolation pattern as WALLET_PROVIDER / SWAP_PROVIDER / PAYMENT_PROVIDER).
 * HttpModule is imported for SumsubKycProvider's HTTP client.
 *
 * AuthModule is imported to provide PinService (needed by KycService for
 * PIN hashing — task K2).
 *
 * K3: KycController added. The WhatsApp handoff-token flow (HandoffTokenService /
 * HandoffTokenPrismaRepository) was retired in Task 7 — the KYC CTA now links to
 * a plain onboarding route (see ConversationService.onboardingUrl). The
 * HandoffToken Prisma model stays dormant in the schema (no migration).
 *
 * WN-5: USER_LISTER token bound to ActiveUserListerPrismaAdapter and exported
 * so AdminModule can provide it to WalletBackfillService. This keeps the
 * wallets→identity cycle broken: wallets/application owns the IUserLister port
 * interface; identity/infrastructure owns the Prisma adapter; AdminModule is
 * the composition root that imports both and resolves the binding.
 */
@Module({
  imports: [AuthModule, WebAuthModule, HttpModule],
  controllers: [KycController, ProfileController],
  providers: [
    ProfileService,
    // Wave C settings writes (PIN change / profile patch / session revoke).
    // PinService resolves from the imported core AuthModule.
    ProfileSettingsService,
    {
      provide: PROFILE_SESSION_REPOSITORY,
      useClass: ProfileSessionPrismaRepository,
    },
    IdentityService,
    KycGateService,
    KycService,
    PinSetupService,
    { provide: IDENTITY_REPOSITORY, useClass: IdentityPrismaRepository },
    { provide: VELOCITY_REPOSITORY, useClass: VelocityPrismaRepository },
    { provide: KYC_REPOSITORY, useClass: KycPrismaRepository },
    // Both KYC adapters registered so the factory can inject either (mock default).
    MockKycProvider,
    SumsubKycProvider,
    {
      provide: KYC_PROVIDER,
      useFactory: selectKycProvider,
      inject: [MockKycProvider, SumsubKycProvider, ConfigService],
    },
    { provide: CLOCK, useClass: SystemClock },
    // WN-5: USER_LISTER adapter lives in identity/infrastructure (the only layer
    // allowed to import PrismaService — CLAUDE.md §3.2). Exported so AdminModule
    // can inject it into WalletBackfillService without a wallets→identity cycle.
    { provide: USER_LISTER, useClass: ActiveUserListerPrismaAdapter },
  ],
  exports: [
    IdentityService,
    KycGateService,
    KycService,
    // Wave C: exported for the MCP module's get_profile tool (read-only).
    ProfileService,
    IDENTITY_REPOSITORY,
    // Phase 2, Task 2: export KYC_REPOSITORY so AdminModule can inject it for
    // the admin KYC-review decision write path (updateKycProfileDecision).
    KYC_REPOSITORY,
    KYC_PROVIDER,
    // WN-5: export USER_LISTER so AdminModule can wire it into WalletBackfillService
    USER_LISTER,
  ],
})
export class IdentityModule {}
