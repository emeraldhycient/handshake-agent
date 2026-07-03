import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { CLOCK, SystemClock } from '../../core/common/clock';
import {
  WALLET_PROVIDER,
  type IWalletProvider,
} from './application/ports/wallet-provider.port';
import {
  SWAP_PROVIDER,
  type ISwapProvider,
} from './application/ports/swap-provider.port';
import { WALLET_REPOSITORY } from './application/ports/wallet.repository.port';
import { BACKFILL_RUN_REPOSITORY } from './application/ports/backfill-run.repository.port';
import { LEDGER_REPOSITORY } from '../transactions/application/ports/ledger.repository.port';
import { LedgerPrismaRepository } from '../transactions/infrastructure/ledger.prisma.repository';
import { WalletService } from './application/wallet.service';
import { WalletBalanceService } from './application/wallet-balance.service';
import { BlockradarProvider } from './infrastructure/blockradar.provider';
import { MockWalletProvider } from './infrastructure/mock-wallet.provider';
import { BlockradarSwapProvider } from './infrastructure/blockradar-swap.provider';
import { MockSwapProvider } from './infrastructure/mock-swap.provider';
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
 * Selects the active swap adapter from the layered config.
 *
 *   SWAP_MOCK_MODE=true  (env-schema default) → MockSwapProvider
 *   SWAP_MOCK_MODE=false                       → BlockradarSwapProvider (live)
 *
 * Default is mock (safe): only an explicit 'false' activates real Blockradar
 * swap calls. Mirrors selectWalletProvider / selectPaymentProvider. Exported so
 * the binding decision can be unit-tested without booting the full DI graph.
 */
export function selectSwapProvider(
  mock: MockSwapProvider,
  real: BlockradarSwapProvider,
  config: ConfigService,
): ISwapProvider {
  return config.get<string>('SWAP_MOCK_MODE') === 'false' ? real : mock;
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
    // Both wallet adapters registered so the factory can inject either (mock default).
    MockWalletProvider,
    BlockradarProvider,
    {
      provide: WALLET_PROVIDER,
      useFactory: selectWalletProvider,
      inject: [MockWalletProvider, BlockradarProvider, ConfigService],
    },
    // Both swap adapters registered so the factory can inject either (mock default).
    MockSwapProvider,
    BlockradarSwapProvider,
    {
      provide: SWAP_PROVIDER,
      useFactory: selectSwapProvider,
      inject: [MockSwapProvider, BlockradarSwapProvider, ConfigService],
    },
    { provide: WALLET_REPOSITORY, useClass: WalletPrismaRepository },
    { provide: BACKFILL_RUN_REPOSITORY, useClass: PrismaBackfillRunRepository },
    // LEDGER_REPOSITORY: bound locally here so WalletBalanceService can read
    // authoritative ledger balances without importing TransactionsModule (which
    // itself imports WalletsModule — that would create a cycle). PrismaService
    // is global, so LedgerPrismaRepository has no unmet dependencies.
    // This mirrors the self-binding pattern already used in BalancesModule.
    { provide: LEDGER_REPOSITORY, useClass: LedgerPrismaRepository },
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
    // Read-only balance/valuation service — exported so AdminModule can inject it
    // for the ADM-02 end-user detail aggregate (Phase 2, Task 5) without re-binding
    // its deep dependency graph (WalletService, RATE_PROVIDER, ledger/wallet repos).
    WalletBalanceService,
    WALLET_PROVIDER,
    SWAP_PROVIDER,
    WALLET_REPOSITORY,
    BACKFILL_RUN_REPOSITORY,
    // Exported so AdminModule can trigger an on-demand Blockradar re-sync from the
    // asset-catalog discovery screen (POST /admin/config/assets/sync).
    CatalogSyncService,
  ],
})
export class WalletsModule {}
