import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { WALLET_PROVIDER } from './application/ports/wallet-provider.port';
import { WALLET_REPOSITORY } from './application/ports/wallet.repository.port';
import { BACKFILL_RUN_REPOSITORY } from './application/ports/backfill-run.repository.port';
import { WalletService } from './application/wallet.service';
import { WalletBalanceService } from './application/wallet-balance.service';
import { BlockradarProvider } from './infrastructure/blockradar.provider';
import { WalletPrismaRepository } from './infrastructure/wallet.prisma.repository';
import { PrismaBackfillRunRepository } from './infrastructure/backfill-run.prisma.repository';
import { WebAuthModule } from '../auth/auth.module';
import { QuotesModule } from '../quotes/quotes.module';
import { WalletController } from './presentation/wallet.controller';

/**
 * Wallets feature module. Wires the Blockradar WaaS adapter, the Prisma
 * repository, WalletService, and the BackfillRun repository (BQ-2).
 *
 * - PrismaModule is global — PrismaService is already in the DI container.
 * - ConfigModule is global — ConfigService is already available.
 * - HttpModule is imported here for the Blockradar HTTP client.
 *
 * WN-5: WalletBackfillService is registered in AdminModule (not here) because
 * it requires USER_LISTER which lives in IdentityModule. Registering it here
 * would require importing IdentityModule → wallets→identity cycle (IdentityModule
 * already imports WalletsModule for WN-3). AdminModule is the composition root
 * that imports both modules and provides WalletBackfillService with full DI.
 *
 * BQ-2: BACKFILL_RUN_REPOSITORY is registered here and exported so AdminModule
 * and WorkerModule processors can inject it.
 */
@Module({
  imports: [HttpModule, WebAuthModule, QuotesModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    WalletBalanceService,
    { provide: WALLET_PROVIDER, useClass: BlockradarProvider },
    { provide: WALLET_REPOSITORY, useClass: WalletPrismaRepository },
    { provide: BACKFILL_RUN_REPOSITORY, useClass: PrismaBackfillRunRepository },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [
    WalletService,
    WALLET_PROVIDER,
    WALLET_REPOSITORY,
    BACKFILL_RUN_REPOSITORY,
  ],
})
export class WalletsModule {}
