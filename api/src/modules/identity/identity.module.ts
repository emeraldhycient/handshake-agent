import { Module } from '@nestjs/common';

import { IDENTITY_REPOSITORY } from './application/ports/identity.repository.port';
import { IdentityService } from './application/identity.service';
import { IdentityPrismaRepository } from './infrastructure/identity.prisma.repository';

/**
 * Identity feature module. PrismaModule is global, so PrismaService is already
 * available in the DI container without importing it here.
 */
@Module({
  providers: [
    IdentityService,
    { provide: IDENTITY_REPOSITORY, useClass: IdentityPrismaRepository },
  ],
  exports: [IdentityService, IDENTITY_REPOSITORY],
})
export class IdentityModule {}
