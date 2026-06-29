import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { IdentityModule } from '../identity/identity.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WhatsAppSenderModule } from '../whatsapp/whatsapp-sender.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { BalancesModule } from '../balances/balances.module';

import {
  ConversationService,
  PROPOSAL_SERVICE,
  DIRECTIVE_SERVICE,
  WALLET_SERVICE,
  HANDOFF_TOKEN_SERVICE,
  BENEFICIARY_SERVICE,
  BALANCE_SERVICE,
} from './application/conversation.service';
import { CONVERSATION_REPOSITORY } from './application/ports/conversation.repository.port';
import { MESSAGE_REPOSITORY } from './application/ports/message.repository.port';
import { INTENT_REPOSITORY } from './application/ports/intent.repository.port';
import { REPLY_REPOSITORY } from './application/ports/reply.repository.port';
import { ConversationPrismaRepository } from './infrastructure/conversation.prisma.repository';
import { MessagePrismaRepository } from './infrastructure/message.prisma.repository';
import { IntentPrismaRepository } from './infrastructure/intent.prisma.repository';
import { ReplyPrismaRepository } from './infrastructure/reply.prisma.repository';
import { INBOUND_HANDLER } from '../whatsapp/application/ports/inbound-handler.port';
import { ProposalService } from '../transactions/application/proposal.service';
import { DirectiveService } from '../transactions/application/directive.service';
import { WalletService } from '../wallets/application/wallet.service';
import { HandoffTokenService } from '../identity/application/handoff-token.service';
import { BeneficiaryService } from '../beneficiaries/application/beneficiary.service';
import { BalanceService } from '../balances/application/balance.service';

/**
 * Conversations feature module.
 *
 * Dependency graph (acyclic):
 *   WhatsAppModule → ConversationsModule → WhatsAppSenderModule
 *                                        → WalletsModule (read-only deposit address)
 *
 * ConversationsModule binds and exports INBOUND_HANDLER → ConversationService.
 * WhatsAppModule imports ConversationsModule to obtain the INBOUND_HANDLER binding
 * without owning any part of the conversation orchestration logic.
 *
 * PrismaModule is global (registered in AppModule) so PrismaService is available
 * without an explicit import here.
 *
 * TransactionsModule exports both ProposalService and DirectiveService; both are
 * re-bound here under local DI tokens so ConversationService uses symbol injection.
 *
 * WalletsModule exports WalletService; re-bound under WALLET_SERVICE token for
 * symbol injection — ConversationsModule does not import from wallets' application
 * layer directly (clean-arch §4.1, depcruise enforced).
 */
@Module({
  imports: [
    AgentModule,
    IdentityModule,
    TransactionsModule,
    WhatsAppSenderModule,
    WalletsModule,
    BeneficiariesModule,
    BalancesModule,
  ],
  providers: [
    ConversationService,
    // Expose ProposalService under our local PROPOSAL_SERVICE token so
    // ConversationService receives it via symbol injection without a direct
    // import of ProposalService in the application layer.
    { provide: PROPOSAL_SERVICE, useExisting: ProposalService },
    // Expose DirectiveService under our local DIRECTIVE_SERVICE token so
    // ConversationService can mint request_pin directives for the Flow path.
    { provide: DIRECTIVE_SERVICE, useExisting: DirectiveService },
    // Expose WalletService under our local WALLET_SERVICE token so
    // ConversationService can provision/read deposit addresses (read-only; §3.1).
    { provide: WALLET_SERVICE, useExisting: WalletService },
    // Expose HandoffTokenService under our local HANDOFF_TOKEN_SERVICE token (K3).
    { provide: HANDOFF_TOKEN_SERVICE, useExisting: HandoffTokenService },
    // Expose BeneficiaryService under our local BENEFICIARY_SERVICE token (W1).
    { provide: BENEFICIARY_SERVICE, useExisting: BeneficiaryService },
    // Expose BalanceService under our local BALANCE_SERVICE token (read-only).
    { provide: BALANCE_SERVICE, useExisting: BalanceService },
    { provide: INBOUND_HANDLER, useExisting: ConversationService },
    {
      provide: CONVERSATION_REPOSITORY,
      useClass: ConversationPrismaRepository,
    },
    { provide: MESSAGE_REPOSITORY, useClass: MessagePrismaRepository },
    { provide: INTENT_REPOSITORY, useClass: IntentPrismaRepository },
    { provide: REPLY_REPOSITORY, useClass: ReplyPrismaRepository },
  ],
  exports: [INBOUND_HANDLER],
})
export class ConversationsModule {}
