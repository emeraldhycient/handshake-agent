import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { IdentityModule } from '../identity/identity.module';
import { QuotesModule } from '../quotes/quotes.module';
import { ProposalService } from './application/proposal.service';
import { PROPOSAL_REPOSITORY } from './application/ports/proposal.repository.port';
import { QUOTE_REPOSITORY } from './application/ports/quote.repository.port';
import { DIRECTIVE_REPOSITORY } from './application/ports/directive.repository.port';
import { DirectiveService } from './application/directive.service';
import { ProposalPrismaRepository } from './infrastructure/proposal.prisma.repository';
import { QuotePrismaRepository } from './infrastructure/quote.prisma.repository';
import { DirectivePrismaRepository } from './infrastructure/directive.prisma.repository';

/**
 * Transactions feature module. Wires the buy-proposal use-case and the
 * DirectiveGrant service (task 4.2, ADR-0005/0006):
 *
 *  - QuotesModule   → exports QuotesService (buy pricing)
 *  - IdentityModule → exports KycGateService (§3.3 gate)
 *  - QUOTE_REPOSITORY / PROPOSAL_REPOSITORY / DIRECTIVE_REPOSITORY → Prisma adapters
 *  - CLOCK → SystemClock (swappable in tests)
 *  - DirectiveService → mints/redeems one-shot signed authority grants
 */
@Module({
  imports: [QuotesModule, IdentityModule],
  providers: [
    ProposalService,
    DirectiveService,
    { provide: QUOTE_REPOSITORY, useClass: QuotePrismaRepository },
    { provide: PROPOSAL_REPOSITORY, useClass: ProposalPrismaRepository },
    { provide: DIRECTIVE_REPOSITORY, useClass: DirectivePrismaRepository },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [ProposalService, DirectiveService],
})
export class TransactionsModule {}
