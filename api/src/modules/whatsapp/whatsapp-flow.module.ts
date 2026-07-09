/**
 * Module that owns the WhatsApp Flows E2E crypto binding and the Flow
 * data-exchange endpoint controller (Task 6.2).
 *
 * Imports TransactionsModule to get ExecutionService (the deterministic engine).
 * Imports BeneficiariesModule to get BeneficiaryService (S3 beneficiary flow).
 * Imports CoreAuthModule to get PinService + SessionService for the R2
 * step-up-on-add chain (PIN verify + device-bound step-up before persist).
 * Does NOT import ConversationsModule — keeps the module graph acyclic.
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → WhatsAppFlowModule → TransactionsModule
 *                                       → BeneficiariesModule
 *                                       → CoreAuthModule
 *
 * ConfigModule is global (registered in AppModule) so FlowCryptoService's and
 * WhatsAppFlowController's ConfigService injections work without an explicit
 * import here.
 */

import { Module } from '@nestjs/common';
import { FLOW_CRYPTO } from './application/ports/flow-crypto.port';
import { FlowCryptoService } from './infrastructure/flow-crypto.service';
import { WhatsAppFlowController } from './presentation/whatsapp-flow.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { AuthModule as CoreAuthModule } from '../../core/auth/auth.module';

@Module({
  // CoreAuthModule exports PinService + SessionService for the step-up-on-add
  // chain (R2) the Flow controller runs before persisting a payout destination.
  imports: [TransactionsModule, BeneficiariesModule, CoreAuthModule],
  controllers: [WhatsAppFlowController],
  providers: [{ provide: FLOW_CRYPTO, useClass: FlowCryptoService }],
  exports: [FLOW_CRYPTO],
})
export class WhatsAppFlowModule {}
