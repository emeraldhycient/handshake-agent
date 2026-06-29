import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { CLOCK, SystemClock } from '../../core/common/clock';
import {
  WALLET_PROVIDER,
  type IWalletProvider,
} from './application/ports/wallet-provider.port';
import { WALLET_REPOSITORY } from './application/ports/wallet.repository.port';
import { BACKFILL_RUN_REPOSITORY } from './application/ports/backfill-run.repository.port';
import { WalletService } from './application/wallet.service';
import { WalletBalanceService } from './application/wallet-balance.service';
import { BlockradarProvider } from './infrastructure/blockradar.provider';
import { MockWalletProvider } from './infrastructure/mock-wallet.provider';
import { WalletPrismaRepository } from './infrastructure/wallet.prisma.repository';
import { PrismaBackfillRunRepository } from './infrastructure/backfill-run.prisma.repository';
import { WebAuthModule } from '../auth/auth.module';
import { QuotesModule } from '../quotes/quotes.module';
import { WalletController } from './presentation/wallet.controller';
import { CatalogSyncService } from '../../core/catalog/catalog-sync.service';

/**
 * Selects the active wallet adapter from the layered config.
 *
 *   WALLET_MOCK_MODE=true  (env-schema default) → MockWalletProvider
 *   WALLET_MOCK_MODE=false                       → BlockradarProvider (live)
 *
 * Default is mock (safe): only an explicit 'false' activates real Blockradar
 * calls. Mirrors KYC_MOCK_MODE / SANCTIONS_MOCK_MODE. Exported so the binding
 * decision can be unit-tested without booting the full DI graph.
 */
export function selectWalletProvider(
  mock: MockWalletProvider,
  real: BlockradarProvider,
  config: ConfigService,
): IWalletProvider {
  return config.get<string>('WALLET_MOCK_MODE') === 'false' ? real : mock;
}

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
    // Both adapters registered so the factory can inject either (mock default).
    MockWalletProvider,
    BlockradarProvider,
    {
      provide: WALLET_PROVIDER,
      useFactory: selectWalletProvider,
      inject: [MockWalletProvider, BlockradarProvider, ConfigService],
    },
    { provide: WALLET_REPOSITORY, useClass: WalletPrismaRepository },
    { provide: BACKFILL_RUN_REPOSITORY, useClass: PrismaBackfillRunRepository },
    { provide: CLOCK, useClass: SystemClock },
    // CatalogSyncService: discovers assets from the active wallet provider on
    // boot and merges them into AssetRegistry's dynamic overlay.
    // Registered here (not in CatalogModule) to avoid a circular dependency:
    // CatalogModule is @Global and WalletsModule already depends on it;
    // putting the sync here keeps the dependency arrow unidirectional.
    CatalogSyncService,
  ],
  exports: [
    WalletService,
    WALLET_PROVIDER,
    WALLET_REPOSITORY,
    BACKFILL_RUN_REPOSITORY,
  ],
})
export class WalletsModule {}
