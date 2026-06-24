/**
 * Module that owns the WhatsApp Flows E2E crypto binding and the Flow
 * data-exchange endpoint controller (Task 6.2).
 *
 * Imports TransactionsModule to get ExecutionService (the deterministic engine).
 * Imports BeneficiariesModule to get BeneficiaryService (S3 beneficiary flow).
 * Does NOT import ConversationsModule — keeps the module graph acyclic.
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → WhatsAppFlowModule → TransactionsModule
 *                                       → BeneficiariesModule
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

@Module({
  imports: [TransactionsModule, BeneficiariesModule],
  controllers: [WhatsAppFlowController],
  providers: [{ provide: FLOW_CRYPTO, useClass: FlowCryptoService }],
  exports: [FLOW_CRYPTO],
})
export class WhatsAppFlowModule {}
