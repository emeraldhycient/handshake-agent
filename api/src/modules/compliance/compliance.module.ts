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
import { SANCTIONS_RECORD_REPOSITORY } from './application/ports/sanctions-record.repository.port';
import { AML_RULE_REPOSITORY } from './application/ports/aml-rule.repository.port';
import { TRAVEL_RULE_REPOSITORY } from './application/ports/travel-rule.repository.port';
import { COMPLIANCE_REPORT_REPOSITORY } from './application/ports/compliance-report.repository.port';
import { ComplianceService } from './application/compliance.service';
import { MockSanctionsScreener } from './infrastructure/mock-sanctions.screener';
import { BlockradarAmlScreener } from './infrastructure/blockradar-aml.screener';
import { ComplianceEventPrismaRepository } from './infrastructure/compliance-event.prisma.repository';
import { SanctionsRecordPrismaRepository } from './infrastructure/sanctions-record.prisma.repository';
import { AmlRulePrismaRepository } from './infrastructure/aml-rule.prisma.repository';
import { TravelRulePrismaRepository } from './infrastructure/travel-rule.prisma.repository';
import { ComplianceReportPrismaRepository } from './infrastructure/compliance-report.prisma.repository';

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
    // Phase 3, sub-area C (admin compliance console): read-only sanctions/Travel-Rule
    // feeds + AML-rule and SAR/STR CRUD. Bound here, consumed by AdminComplianceService
    // (in AdminModule) which imports ComplianceModule for these tokens.
    {
      provide: SANCTIONS_RECORD_REPOSITORY,
      useClass: SanctionsRecordPrismaRepository,
    },
    { provide: AML_RULE_REPOSITORY, useClass: AmlRulePrismaRepository },
    { provide: TRAVEL_RULE_REPOSITORY, useClass: TravelRulePrismaRepository },
    {
      provide: COMPLIANCE_REPORT_REPOSITORY,
      useClass: ComplianceReportPrismaRepository,
    },
  ],
  exports: [
    ComplianceService,
    SANCTIONS_SCREENER,
    COMPLIANCE_EVENT_REPOSITORY,
    SANCTIONS_RECORD_REPOSITORY,
    AML_RULE_REPOSITORY,
    TRAVEL_RULE_REPOSITORY,
    COMPLIANCE_REPORT_REPOSITORY,
  ],
})
export class ComplianceModule {}
