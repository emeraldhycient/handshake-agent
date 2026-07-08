/**
 * ChatModule — web chat endpoint for the agent-driven conversation surface.
 *
 * Provides its OWN bindings for the four conversation repo tokens (they are
 * declared in ConversationsModule.providers but not exported from it). We use
 * `useClass` with the same Prisma repository classes; PrismaService is global
 * (AppModule imports PrismaModule globally) so these repos receive it injected.
 *
 * CatalogModule is @Global so AssetRegistry is available in the DI container
 * without importing CatalogModule here.
 */

import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { IdentityModule } from '../identity/identity.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { BalancesModule } from '../balances/balances.module';
import { WebAuthModule } from '../auth/auth.module';
import { AuthModule } from '../../core/auth/auth.module';
import { MediaModule } from '../media/media.module';

import { ProposalService } from '../transactions/application/proposal.service';
import { WalletService } from '../wallets/application/wallet.service';
import { BeneficiaryService } from '../beneficiaries/application/beneficiary.service';
import { TransactionHistoryService } from '../transactions/application/transaction-history.service';
import { BalanceService } from '../balances/application/balance.service';

import { CONVERSATION_REPOSITORY } from '../conversations/application/ports/conversation.repository.port';
import { MESSAGE_REPOSITORY } from '../conversations/application/ports/message.repository.port';
import { INTENT_REPOSITORY } from '../conversations/application/ports/intent.repository.port';
import { REPLY_REPOSITORY } from '../conversations/application/ports/reply.repository.port';
import { ConversationPrismaRepository } from '../conversations/infrastructure/conversation.prisma.repository';
import { MessagePrismaRepository } from '../conversations/infrastructure/message.prisma.repository';
import { IntentPrismaRepository } from '../conversations/infrastructure/intent.prisma.repository';
import { ReplyPrismaRepository } from '../conversations/infrastructure/reply.prisma.repository';

import {
  WebChatService,
  WEB_CHAT_PROPOSAL_SERVICE,
  WEB_CHAT_WALLET_SERVICE,
  WEB_CHAT_BENEFICIARY_SERVICE,
  WEB_CHAT_HISTORY_SERVICE,
  WEB_CHAT_BALANCE_SERVICE,
} from './application/web-chat.service';
import { ChatController } from './presentation/chat.controller';
import { VoiceChatController } from './presentation/voice-chat.controller';
import {
  ProposalController,
  TransactionStatusController,
} from './presentation/proposal.controller';
import {
  TransactionHistoryController,
  StatementDownloadController,
} from './presentation/transaction-history.controller';

@Module({
  imports: [
    AgentModule, // exports AGENT_PORT
    IdentityModule, // exports IDENTITY_REPOSITORY, IdentityService
    WalletsModule, // exports WalletService
    BeneficiariesModule, // exports BeneficiaryService
    TransactionsModule, // exports ProposalService
    BalancesModule, // exports BalanceService
    WebAuthModule, // exports JwtAuthGuard
    AuthModule, // core auth — exports SessionService (device-bound step-up, §3.4)
    MediaModule, // exports TRANSCRIPTION_PORT
  ],
  controllers: [
    ChatController,
    VoiceChatController,
    ProposalController,
    // History + statement routes must precede TransactionStatusController so the
    // literal `transactions/history` path resolves before `transactions/:id`.
    TransactionHistoryController,
    StatementDownloadController,
    TransactionStatusController,
  ],
  providers: [
    WebChatService,
    // Alias domain services under local DI tokens (symbol injection in WebChatService).
    { provide: WEB_CHAT_PROPOSAL_SERVICE, useExisting: ProposalService },
    { provide: WEB_CHAT_WALLET_SERVICE, useExisting: WalletService },
    { provide: WEB_CHAT_BENEFICIARY_SERVICE, useExisting: BeneficiaryService },
    {
      provide: WEB_CHAT_HISTORY_SERVICE,
      useExisting: TransactionHistoryService,
    },
    { provide: WEB_CHAT_BALANCE_SERVICE, useExisting: BalanceService },
    // Conversation repository bindings — ConversationsModule does not export these
    // tokens so ChatModule provides its own instances backed by the same Prisma classes.
    // PrismaService is global (registered via PrismaModule in AppModule) so it is
    // injected without an explicit import here.
    {
      provide: CONVERSATION_REPOSITORY,
      useClass: ConversationPrismaRepository,
    },
    { provide: MESSAGE_REPOSITORY, useClass: MessagePrismaRepository },
    { provide: INTENT_REPOSITORY, useClass: IntentPrismaRepository },
    { provide: REPLY_REPOSITORY, useClass: ReplyPrismaRepository },
  ],
  // WebChatService is exported for the MCP module's send_chat_message tool
  // (Wave C): the SAME propose-only turn pipeline, reached in-process (§3.1).
  exports: [WebChatService],
})
export class ChatModule {}
