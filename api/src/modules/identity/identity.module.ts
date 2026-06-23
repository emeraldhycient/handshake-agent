import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { IDENTITY_REPOSITORY } from './application/ports/identity.repository.port';
import { VELOCITY_REPOSITORY } from './application/ports/velocity.repository.port';
import { KYC_PROVIDER } from './application/ports/kyc-provider.port';
import { IdentityService } from './application/identity.service';
import { KycGateService } from './application/kyc-gate.service';
import { IdentityPrismaRepository } from './infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from './infrastructure/velocity.prisma.repository';
import { MockKycProvider } from './infrastructure/mock-kyc.provider';

/**
 * Identity feature module. PrismaModule is global, so PrismaService is already
 * available in the DI container without importing it here. ConfigModule is
 * global (see AppModule), so ConfigService is also available without import.
 *
 * KYC_PROVIDER is bound to MockKycProvider at launch. A real NIN/BVN/liveness
 * adapter implements IKycProvider and replaces useClass here (same isolation
 * pattern as WALLET_PROVIDER / LlmProvider — task K1).
 */
@Module({
  providers: [
    IdentityService,
    KycGateService,
    { provide: IDENTITY_REPOSITORY, useClass: IdentityPrismaRepository },
    { provide: VELOCITY_REPOSITORY, useClass: VelocityPrismaRepository },
    { provide: KYC_PROVIDER, useClass: MockKycProvider },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [IdentityService, KycGateService, IDENTITY_REPOSITORY, KYC_PROVIDER],
})
export class IdentityModule {}
