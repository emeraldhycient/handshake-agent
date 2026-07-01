import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth/auth.module';
import { WebAuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { CLOCK, SystemClock } from '../../core/common/clock';
import { IDENTITY_REPOSITORY } from './application/ports/identity.repository.port';
import { VELOCITY_REPOSITORY } from './application/ports/velocity.repository.port';
import { KYC_PROVIDER } from './application/ports/kyc-provider.port';
import { KYC_REPOSITORY } from './application/ports/kyc.repository.port';
import { HANDOFF_TOKEN_REPOSITORY } from './application/ports/handoff-token.repository.port';
import { USER_LISTER } from '../wallets/application/ports/user-lister.port';
import { IdentityService } from './application/identity.service';
import { KycGateService } from './application/kyc-gate.service';
import { KycService } from './application/kyc.service';
import { PinSetupService } from './application/pin-setup.service';
import { HandoffTokenService } from './application/handoff-token.service';
import { IdentityPrismaRepository } from './infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from './infrastructure/velocity.prisma.repository';
import { KycPrismaRepository } from './infrastructure/kyc.prisma.repository';
import { HandoffTokenPrismaRepository } from './infrastructure/handoff-token.prisma.repository';
import { ActiveUserListerPrismaAdapter } from './infrastructure/active-user-lister.prisma';
import { MockKycProvider } from './infrastructure/mock-kyc.provider';
import { KycController } from './presentation/kyc.controller';
import { ProfileService } from './application/profile.service';
import { ProfileController } from './presentation/profile.controller';

/**
 * Identity feature module. PrismaModule is global, so PrismaService is already
 * available in the DI container without importing it here. ConfigModule is
 * global (see AppModule), so ConfigService is also available without import.
 *
 * KYC_PROVIDER is bound to MockKycProvider at launch. A real NIN/BVN/liveness
 * adapter implements IKycProvider and replaces useClass here (same isolation
 * pattern as WALLET_PROVIDER / LlmProvider — task K1).
 *
 * AuthModule is imported to provide PinService (needed by KycService for
 * PIN hashing — task K2).
 *
 * K3: HandoffTokenService + HandoffTokenPrismaRepository + KycController added.
 *
 * WN-3: WalletsModule imported so WalletService can be injected into
 * KycController for eager post-KYC address provisioning (best-effort).
 * The dependency lives at the presentation/composition layer — dep-cruiser
 * permits this; no forbidden cross-feature rule applies here.
 *
 * WN-5: USER_LISTER token bound to ActiveUserListerPrismaAdapter and exported
 * so AdminModule can provide it to WalletBackfillService. This keeps the
 * wallets→identity cycle broken: wallets/application owns the IUserLister port
 * interface; identity/infrastructure owns the Prisma adapter; AdminModule is
 * the composition root that imports both and resolves the binding.
 */
@Module({
  imports: [AuthModule, WebAuthModule, WalletsModule],
  controllers: [KycController, ProfileController],
  providers: [
    ProfileService,
    IdentityService,
    KycGateService,
    KycService,
    PinSetupService,
    HandoffTokenService,
    { provide: IDENTITY_REPOSITORY, useClass: IdentityPrismaRepository },
    { provide: VELOCITY_REPOSITORY, useClass: VelocityPrismaRepository },
    { provide: KYC_REPOSITORY, useClass: KycPrismaRepository },
    {
      provide: HANDOFF_TOKEN_REPOSITORY,
      useClass: HandoffTokenPrismaRepository,
    },
    { provide: KYC_PROVIDER, useClass: MockKycProvider },
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
    HandoffTokenService,
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
