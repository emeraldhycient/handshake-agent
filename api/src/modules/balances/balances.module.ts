import { Module } from '@nestjs/common';

import { WalletsModule } from '../wallets/wallets.module';
import { QuotesModule } from '../quotes/quotes.module';
import { LEDGER_REPOSITORY } from '../transactions/application/ports/ledger.repository.port';
import { LedgerPrismaRepository } from '../transactions/infrastructure/ledger.prisma.repository';
import { BalanceService } from './application/balance.service';

/**
 * Balances feature module — read-only portfolio snapshots for the agent surfaces.
 *
 * Wires BalanceService against ports it does not own:
 *   - WalletsModule  → exports WALLET_REPOSITORY (find the user's per-network wallet)
 *   - QuotesModule   → exports RATE_PROVIDER (mid-market valuation)
 *   - LEDGER_REPOSITORY → bound here to the Prisma adapter (TransactionsModule does
 *     not export it; PrismaService is global, so a local binding avoids importing
 *     TransactionsModule and the resulting wallets↔transactions cycle). Mirrors the
 *     self-binding pattern ChatModule uses for the conversation repositories.
 *
 * CatalogModule is @Global, so AssetRegistry is already in the container.
 *
 * BalanceService is read-only (§3.1): it never provisions a wallet or moves money.
 */
@Module({
  imports: [WalletsModule, QuotesModule],
  providers: [
    BalanceService,
    { provide: LEDGER_REPOSITORY, useClass: LedgerPrismaRepository },
  ],
  exports: [BalanceService],
})
export class BalancesModule {}
