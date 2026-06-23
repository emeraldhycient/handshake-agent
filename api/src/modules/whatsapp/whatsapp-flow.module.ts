/**
 * Thin module that owns the WhatsApp Flows E2E crypto binding.
 *
 * Kept separate from WhatsAppSenderModule and WhatsAppModule to maintain an
 * acyclic dependency graph. The Flow endpoint controller (6.2) will import
 * this module or have it re-exported from WhatsAppModule.
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → WhatsAppFlowModule (no further deps)
 *
 * ConfigModule is global (registered in AppModule) so FlowCryptoService's
 * ConfigService injection works without an explicit import here.
 */

import { Module } from '@nestjs/common';
import { FLOW_CRYPTO } from './application/ports/flow-crypto.port';
import { FlowCryptoService } from './infrastructure/flow-crypto.service';

@Module({
  providers: [{ provide: FLOW_CRYPTO, useClass: FlowCryptoService }],
  exports: [FLOW_CRYPTO],
})
export class WhatsAppFlowModule {}
