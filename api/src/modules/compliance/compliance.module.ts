/**
 * ComplianceModule — sanctions/AML screening (N2).
 *
 * Provides ComplianceService (the application facade) and binds the
 * swappable ports:
 *   - SANCTIONS_SCREENER → MockSanctionsScreener (real provider later)
 *   - COMPLIANCE_EVENT_REPOSITORY → ComplianceEventPrismaRepository
 *
 * PrismaModule and ConfigModule are global; no explicit import needed.
 *
 * Exports ComplianceService and SANCTIONS_SCREENER so N3 (send proposal)
 * can import this module and inject the service.
 */

import { Module } from '@nestjs/common';

import { SANCTIONS_SCREENER } from './application/ports/sanctions-screener.port';
import { COMPLIANCE_EVENT_REPOSITORY } from './application/ports/compliance-event.repository.port';
import { ComplianceService } from './application/compliance.service';
import { MockSanctionsScreener } from './infrastructure/mock-sanctions.screener';
import { ComplianceEventPrismaRepository } from './infrastructure/compliance-event.prisma.repository';

@Module({
  providers: [
    ComplianceService,
    { provide: SANCTIONS_SCREENER, useClass: MockSanctionsScreener },
    {
      provide: COMPLIANCE_EVENT_REPOSITORY,
      useClass: ComplianceEventPrismaRepository,
    },
  ],
  exports: [ComplianceService, SANCTIONS_SCREENER],
})
export class ComplianceModule {}
