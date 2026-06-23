import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { AuthModule } from '../../core/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { QuotesModule } from '../quotes/quotes.module';
import { WalletsModule } from '../wallets/wallets.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { ProposalService } from './application/proposal.service';
import { DirectiveService } from './application/directive.service';
import { ExecutionService } from './application/execution.service';
import { PROPOSAL_REPOSITORY } from './application/ports/proposal.repository.port';
import { QUOTE_REPOSITORY } from './application/ports/quote.repository.port';
import { DIRECTIVE_REPOSITORY } from './application/ports/directive.repository.port';
import { TRANSACTION_REPOSITORY } from './application/ports/transaction.repository.port';
import { SETTLEMENT_OUTBOX_REPOSITORY } from './application/ports/settlement-outbox.repository.port';
import { ProposalPrismaRepository } from './infrastructure/proposal.prisma.repository';
import { QuotePrismaRepository } from './infrastructure/quote.prisma.repository';
import { DirectivePrismaRepository } from './infrastructure/directive.prisma.repository';
import { TransactionPrismaRepository } from './infrastructure/transaction.prisma.repository';
import { SettlementOutboxPrismaRepository } from './infrastructure/settlement-outbox.prisma.repository';

/**
 * Transactions feature module. Wires the buy-proposal, directive, and execution
 * engine use-cases (tasks 4.1, 4.2, 4.5a):
 *
 *  - QuotesModule   → exports QuotesService (buy pricing / re-quote for drift)
 *  - IdentityModule → exports KycGateService (§3.3 server-side gate)
 *  - AuthModule     → exports PinService (§3.4 PIN verification)
 *  - WalletsModule  → exports WalletService (get-or-provision USDT wallet)
 *  - TreasuryModule → exports PAYMENT_PROVIDER (Flutterwave collection)
 *  - QUOTE_REPOSITORY / PROPOSAL_REPOSITORY / DIRECTIVE_REPOSITORY → Prisma adapters
 *  - TRANSACTION_REPOSITORY / SETTLEMENT_OUTBOX_REPOSITORY → Prisma adapters (4.5a)
 *  - CLOCK → SystemClock (swappable in tests)
 *  - DirectiveService → mints/redeems one-shot signed authority grants
 *  - ExecutionService → the only code that constructs Transaction rows
 */
@Module({
  imports: [
    QuotesModule,
    IdentityModule,
    AuthModule,
    WalletsModule,
    TreasuryModule,
  ],
  providers: [
    ProposalService,
    DirectiveService,
    ExecutionService,
    { provide: QUOTE_REPOSITORY, useClass: QuotePrismaRepository },
    { provide: PROPOSAL_REPOSITORY, useClass: ProposalPrismaRepository },
    { provide: DIRECTIVE_REPOSITORY, useClass: DirectivePrismaRepository },
    { provide: TRANSACTION_REPOSITORY, useClass: TransactionPrismaRepository },
    {
      provide: SETTLEMENT_OUTBOX_REPOSITORY,
      useClass: SettlementOutboxPrismaRepository,
    },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [ProposalService, DirectiveService, ExecutionService],
})
export class TransactionsModule {}
