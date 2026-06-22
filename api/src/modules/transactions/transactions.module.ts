import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { IdentityModule } from '../identity/identity.module';
import { QuotesModule } from '../quotes/quotes.module';
import { ProposalService } from './application/proposal.service';
import { PROPOSAL_REPOSITORY } from './application/ports/proposal.repository.port';
import { QUOTE_REPOSITORY } from './application/ports/quote.repository.port';
import { ProposalPrismaRepository } from './infrastructure/proposal.prisma.repository';
import { QuotePrismaRepository } from './infrastructure/quote.prisma.repository';

/**
 * Transactions feature module. Wires the buy-proposal use-case:
 *
 *  - QuotesModule   → exports QuotesService (buy pricing)
 *  - IdentityModule → exports KycGateService (§3.3 gate)
 *  - QUOTE_REPOSITORY / PROPOSAL_REPOSITORY → Prisma adapters
 *  - CLOCK → SystemClock (swappable in tests)
 */
@Module({
  imports: [QuotesModule, IdentityModule],
  providers: [
    ProposalService,
    { provide: QUOTE_REPOSITORY, useClass: QuotePrismaRepository },
    { provide: PROPOSAL_REPOSITORY, useClass: ProposalPrismaRepository },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [ProposalService],
})
export class TransactionsModule {}
