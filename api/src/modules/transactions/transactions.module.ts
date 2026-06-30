import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { AuthModule } from '../../core/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { QuotesModule } from '../quotes/quotes.module';
import { WalletsModule } from '../wallets/wallets.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { WhatsAppSenderModule } from '../whatsapp/whatsapp-sender.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { ProposalService } from './application/proposal.service';
import { DirectiveService } from './application/directive.service';
import { ExecutionService } from './application/execution.service';
import { SettlementReconciliationService } from './application/settlement-reconciliation.service';
import { PROPOSAL_REPOSITORY } from './application/ports/proposal.repository.port';
import { QUOTE_REPOSITORY } from './application/ports/quote.repository.port';
import { DIRECTIVE_REPOSITORY } from './application/ports/directive.repository.port';
import { TRANSACTION_REPOSITORY } from './application/ports/transaction.repository.port';
import { SETTLEMENT_OUTBOX_REPOSITORY } from './application/ports/settlement-outbox.repository.port';
import { SETTLEMENT_REPOSITORY } from './application/ports/settlement.repository.port';
import { LEDGER_REPOSITORY } from './application/ports/ledger.repository.port';
import { TRANSACTION_READ_REPOSITORY } from './application/ports/transaction-read.repository.port';
import { ProposalPrismaRepository } from './infrastructure/proposal.prisma.repository';
import { QuotePrismaRepository } from './infrastructure/quote.prisma.repository';
import { DirectivePrismaRepository } from './infrastructure/directive.prisma.repository';
import { TransactionPrismaRepository } from './infrastructure/transaction.prisma.repository';
import { SettlementOutboxPrismaRepository } from './infrastructure/settlement-outbox.prisma.repository';
import { SettlementPrismaRepository } from './infrastructure/settlement.prisma.repository';
import { LedgerPrismaRepository } from './infrastructure/ledger.prisma.repository';
import { TransactionReadPrismaRepository } from './infrastructure/transaction-read.prisma.repository';
import { TransactionHistoryService } from './application/transaction-history.service';
import { StatementTokenService } from './application/statement-token.service';
import { STATEMENT_GENERATOR } from './application/ports/statement-generator.port';
import { PdfStatementGenerator } from './infrastructure/pdf-statement.generator';

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
 *  - SETTLEMENT_REPOSITORY → Prisma adapter (4.5b — atomic settle + receipt)
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
    BeneficiariesModule,
    WhatsAppSenderModule,
    ComplianceModule,
  ],
  providers: [
    ProposalService,
    DirectiveService,
    ExecutionService,
    SettlementReconciliationService,
    { provide: QUOTE_REPOSITORY, useClass: QuotePrismaRepository },
    { provide: PROPOSAL_REPOSITORY, useClass: ProposalPrismaRepository },
    { provide: DIRECTIVE_REPOSITORY, useClass: DirectivePrismaRepository },
    { provide: TRANSACTION_REPOSITORY, useClass: TransactionPrismaRepository },
    {
      provide: SETTLEMENT_OUTBOX_REPOSITORY,
      useClass: SettlementOutboxPrismaRepository,
    },
    {
      provide: SETTLEMENT_REPOSITORY,
      useClass: SettlementPrismaRepository,
    },
    { provide: LEDGER_REPOSITORY, useClass: LedgerPrismaRepository },
    {
      provide: TRANSACTION_READ_REPOSITORY,
      useClass: TransactionReadPrismaRepository,
    },
    { provide: CLOCK, useClass: SystemClock },
    TransactionHistoryService,
    StatementTokenService,
    { provide: STATEMENT_GENERATOR, useClass: PdfStatementGenerator },
  ],
  exports: [
    ProposalService,
    DirectiveService,
    ExecutionService,
    PROPOSAL_REPOSITORY,
    TRANSACTION_REPOSITORY,
    TRANSACTION_READ_REPOSITORY,
    SETTLEMENT_REPOSITORY,
    // Exported for AdminModule's transaction-triage service (Phase 3B): it
    // re-enqueues the settlement outbox row for the reconciliation worker.
    SETTLEMENT_OUTBOX_REPOSITORY,
    // CLOCK is exported so admin-side engine-brokered actions (triage refunds)
    // stamp timestamps from the same injected clock the engine uses.
    CLOCK,
    TransactionHistoryService,
    StatementTokenService,
    STATEMENT_GENERATOR,
  ],
})
export class TransactionsModule {}
