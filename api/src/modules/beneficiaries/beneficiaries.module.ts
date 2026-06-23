/**
 * Beneficiaries feature module (S3).
 *
 * Wires BeneficiaryService (application) → BeneficiaryPrismaRepository
 * (infrastructure) via the BENEFICIARY_REPOSITORY port symbol.
 *
 * CatalogModule is imported to provide AssetRegistry (used by BeneficiaryService
 * to validate crypto addresses). PrismaModule and ConfigModule are global.
 *
 * Exports BeneficiaryService so WhatsAppFlowModule (and later the agent tool
 * gateway) can inject it without importing this module's internals.
 */

import { Module } from '@nestjs/common';

import { BeneficiaryService } from './application/beneficiary.service';
import { BENEFICIARY_REPOSITORY } from './application/ports/beneficiary.repository.port';
import { BeneficiaryPrismaRepository } from './infrastructure/beneficiary.prisma.repository';

// CatalogModule is @Global (catalog.module.ts) — AssetRegistry is available
// in the DI container without importing CatalogModule here.

@Module({
  providers: [
    BeneficiaryService,
    {
      provide: BENEFICIARY_REPOSITORY,
      useClass: BeneficiaryPrismaRepository,
    },
  ],
  exports: [BeneficiaryService],
})
export class BeneficiariesModule {}
