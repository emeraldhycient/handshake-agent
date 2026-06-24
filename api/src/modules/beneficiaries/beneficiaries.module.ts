/**
 * Beneficiaries feature module (S3 + Fix E).
 *
 * Wires BeneficiaryService (application) → BeneficiaryPrismaRepository
 * (infrastructure) via the BENEFICIARY_REPOSITORY port symbol, and
 * MockNameEnquiry → BANK_NAME_ENQUIRY port (real provider swapped in later).
 *
 * CatalogModule is @Global (catalog.module.ts) — AssetRegistry is available
 * in the DI container without importing CatalogModule here.
 * PrismaModule and ConfigModule are global.
 *
 * Exports BeneficiaryService and BANK_NAME_ENQUIRY so WhatsAppFlowModule (and
 * later the agent tool gateway) can inject either without importing internals.
 */

import { Module } from '@nestjs/common';

import { BeneficiaryService } from './application/beneficiary.service';
import { BENEFICIARY_REPOSITORY } from './application/ports/beneficiary.repository.port';
import { BANK_NAME_ENQUIRY } from './application/ports/name-enquiry.port';
import { BeneficiaryPrismaRepository } from './infrastructure/beneficiary.prisma.repository';
import { MockNameEnquiry } from './infrastructure/mock-name-enquiry';

@Module({
  providers: [
    BeneficiaryService,
    {
      provide: BENEFICIARY_REPOSITORY,
      useClass: BeneficiaryPrismaRepository,
    },
    {
      provide: BANK_NAME_ENQUIRY,
      useClass: MockNameEnquiry,
    },
  ],
  exports: [BeneficiaryService, BANK_NAME_ENQUIRY],
})
export class BeneficiariesModule {}
