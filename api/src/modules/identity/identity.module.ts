import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { IDENTITY_REPOSITORY } from './application/ports/identity.repository.port';
import { VELOCITY_REPOSITORY } from './application/ports/velocity.repository.port';
import { IdentityService } from './application/identity.service';
import { KycGateService } from './application/kyc-gate.service';
import { IdentityPrismaRepository } from './infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from './infrastructure/velocity.prisma.repository';

/**
 * Identity feature module. PrismaModule is global, so PrismaService is already
 * available in the DI container without importing it here. ConfigModule is
 * global (see AppModule), so ConfigService is also available without import.
 */
@Module({
  providers: [
    IdentityService,
    KycGateService,
    { provide: IDENTITY_REPOSITORY, useClass: IdentityPrismaRepository },
    { provide: VELOCITY_REPOSITORY, useClass: VelocityPrismaRepository },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [IdentityService, KycGateService, IDENTITY_REPOSITORY],
})
export class IdentityModule {}
