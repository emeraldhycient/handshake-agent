/**
 * ComplianceModule — sanctions/AML screening (N2).
 *
 * Provides ComplianceService (the application facade) and binds the
 * swappable ports:
 *   - SANCTIONS_SCREENER → factory-selected adapter (see below)
 *   - COMPLIANCE_EVENT_REPOSITORY → ComplianceEventPrismaRepository
 *
 * SANCTIONS_SCREENER binding selection (config-driven):
 *   SANCTIONS_MOCK_MODE=true  (default) → MockSanctionsScreener
 *   SANCTIONS_MOCK_MODE=false           → BlockradarAmlScreener (live AML)
 *
 * Both adapters are registered as providers so the factory can reference them.
 * HttpModule is imported for BlockradarAmlScreener's HttpService dependency.
 *
 * PrismaModule and ConfigModule are global; no explicit import needed.
 *
 * Exports ComplianceService and SANCTIONS_SCREENER so N3 (send proposal)
 * can import this module and inject the service.
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { SANCTIONS_SCREENER } from './application/ports/sanctions-screener.port';
import { COMPLIANCE_EVENT_REPOSITORY } from './application/ports/compliance-event.repository.port';
import { ComplianceService } from './application/compliance.service';
import { MockSanctionsScreener } from './infrastructure/mock-sanctions.screener';
import { BlockradarAmlScreener } from './infrastructure/blockradar-aml.screener';
import { ComplianceEventPrismaRepository } from './infrastructure/compliance-event.prisma.repository';

@Module({
  imports: [HttpModule],
  providers: [
    ComplianceService,
    // Register both adapters so the factory below can inject either.
    // This follows the same pattern as IdentityModule (MockKycProvider + real provider).
    MockSanctionsScreener,
    BlockradarAmlScreener,
    {
      provide: SANCTIONS_SCREENER,
      useFactory: (
        mock: MockSanctionsScreener,
        real: BlockradarAmlScreener,
        config: ConfigService,
      ) => {
        const mockMode = config.get<string>('SANCTIONS_MOCK_MODE');
        // Default is mock (env schema default = 'true'); only activate the real
        // adapter when explicitly set to 'false'.
        return mockMode === 'false' ? real : mock;
      },
      inject: [MockSanctionsScreener, BlockradarAmlScreener, ConfigService],
    },
    {
      provide: COMPLIANCE_EVENT_REPOSITORY,
      useClass: ComplianceEventPrismaRepository,
    },
  ],
  exports: [ComplianceService, SANCTIONS_SCREENER],
})
export class ComplianceModule {}
