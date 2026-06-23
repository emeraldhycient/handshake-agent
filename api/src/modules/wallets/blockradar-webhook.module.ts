/**
 * BlockradarWebhookModule — wires the Blockradar deposit/withdraw webhook
 * controller that credits on-chain deposits, settles on-chain sends, and
 * sends WhatsApp receipts (R2).
 *
 * Dependency graph (acyclic — verified by dependency-cruiser):
 *   BlockradarWebhookModule
 *     → WalletsModule         (exports WalletService; provides WALLET_REPOSITORY)
 *     → WhatsAppSenderModule  (exports WHATSAPP_SENDER)
 *     → IdentityModule        (exports IdentityService)
 *     → TransactionsModule    (exports ExecutionService for withdraw settlement)
 *   None of those modules import BlockradarWebhookModule → no cycle.
 *
 * ConfigModule, PrismaModule, and CatalogModule are global (registered in
 * AppModule) so ConfigService, PrismaService, and AssetRegistry are available
 * here without explicit imports.
 *
 * DEPOSIT_SETTLEMENT_REPOSITORY is provided directly in this module (not
 * exported) — no other module depends on it.
 */

import { Module } from '@nestjs/common';

import { WalletsModule } from './wallets.module';
import { IdentityModule } from '../identity/identity.module';
import { WhatsAppSenderModule } from '../whatsapp/whatsapp-sender.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DEPOSIT_SETTLEMENT_REPOSITORY } from './application/ports/deposit-settlement.repository.port';
import { DepositSettlementPrismaRepository } from './infrastructure/deposit-settlement.prisma.repository';
import { BlockradarWebhookController } from './presentation/blockradar-webhook.controller';

@Module({
  imports: [
    WalletsModule,
    IdentityModule,
    WhatsAppSenderModule,
    TransactionsModule,
  ],
  controllers: [BlockradarWebhookController],
  providers: [
    {
      provide: DEPOSIT_SETTLEMENT_REPOSITORY,
      useClass: DepositSettlementPrismaRepository,
    },
  ],
})
export class BlockradarWebhookModule {}
