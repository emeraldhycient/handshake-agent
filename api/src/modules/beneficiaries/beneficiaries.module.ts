/**
 * Beneficiaries feature module (S3 + Fix E).
 *
 * Wires BeneficiaryService (application) → BeneficiaryPrismaRepository
 * (infrastructure) via the BENEFICIARY_REPOSITORY port symbol, and the
 * name-enquiry port via a flag-driven factory:
 *
 *   NAME_ENQUIRY_MOCK_MODE=true  (env-schema default) → MockNameEnquiry
 *   NAME_ENQUIRY_MOCK_MODE=false                       → FlutterwaveNameEnquiry (live)
 *
 * Default is mock (safe): only an explicit 'false' activates real Flutterwave
 * calls. Mirrors selectPaymentProvider (TreasuryModule) and SANCTIONS_MOCK_MODE
 * (ComplianceModule).
 *
 * CatalogModule is @Global (catalog.module.ts) — AssetRegistry is available
 * in the DI container without importing CatalogModule here.
 * PrismaModule and ConfigModule are global.
 * HttpModule is imported here for FlutterwaveNameEnquiry's HttpService dependency.
 *
 * Exports BeneficiaryService and BANK_NAME_ENQUIRY so WhatsAppFlowModule (and
 * later the agent tool gateway) can inject either without importing internals.
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { WebAuthModule } from '../auth/auth.module';
import { BeneficiaryService } from './application/beneficiary.service';
import { BENEFICIARY_REPOSITORY } from './application/ports/beneficiary.repository.port';
import {
  BANK_NAME_ENQUIRY,
  type INameEnquiry,
} from './application/ports/name-enquiry.port';
import { BeneficiaryPrismaRepository } from './infrastructure/beneficiary.prisma.repository';
import { MockNameEnquiry } from './infrastructure/mock-name-enquiry';
import { FlutterwaveNameEnquiry } from './infrastructure/flutterwave-name-enquiry';
import { BeneficiaryController } from './presentation/beneficiary.controller';

/**
 * Selects the active name-enquiry adapter from the layered config.
 *
 *   NAME_ENQUIRY_MOCK_MODE=true  (env-schema default) → MockNameEnquiry
 *   NAME_ENQUIRY_MOCK_MODE=false                       → FlutterwaveNameEnquiry (live)
 *
 * Default is mock (safe): only an explicit 'false' activates real Flutterwave
 * calls. Mirrors selectPaymentProvider in treasury.module.ts exactly.
 * Exported so the binding decision can be unit-tested without booting the full
 * DI graph (see beneficiaries.module.spec.ts).
 */
export function selectNameEnquiryProvider(
  mock: MockNameEnquiry,
  real: FlutterwaveNameEnquiry,
  config: ConfigService,
): INameEnquiry {
  return config.get<string>('NAME_ENQUIRY_MOCK_MODE') === 'false' ? real : mock;
}

@Module({
  // WebAuthModule exports JwtAuthGuard so the web beneficiary endpoints can
  // require a verified session (§3.3). It does not import BeneficiariesModule,
  // so there is no dependency cycle.
  // HttpModule is imported for FlutterwaveNameEnquiry's HttpService dependency.
  imports: [WebAuthModule, HttpModule],
  controllers: [BeneficiaryController],
  providers: [
    BeneficiaryService,
    {
      provide: BENEFICIARY_REPOSITORY,
      useClass: BeneficiaryPrismaRepository,
    },
    // Register both adapters so the factory below can inject either.
    MockNameEnquiry,
    FlutterwaveNameEnquiry,
    {
      provide: BANK_NAME_ENQUIRY,
      useFactory: selectNameEnquiryProvider,
      inject: [MockNameEnquiry, FlutterwaveNameEnquiry, ConfigService],
    },
  ],
  exports: [BeneficiaryService, BANK_NAME_ENQUIRY],
})
export class BeneficiariesModule {}
