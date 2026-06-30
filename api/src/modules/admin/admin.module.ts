import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { WalletsModule } from '../wallets/wallets.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminTokenGuard } from './guards/admin-token.guard';
import { AdminWalletsController } from './presentation/admin-wallets.controller';
import { WalletBackfillService } from '../wallets/application/wallet-backfill.service';
import { WalletReconciliationService } from '../wallets/application/wallet-reconciliation.service';
import { BullBoardBasicAuthMiddleware } from './bull-board.middleware';
import { ECHO_QUEUE_NAME } from '../../core/jobs/echo-queue.constants';
import { WALLET_BACKFILL_QUEUE_NAME } from '../wallets/application/wallet-backfill-queue.constants';
import { DEPOSIT_SETTLEMENT_REPOSITORY } from '../wallets/application/ports/deposit-settlement.repository.port';
import { DepositSettlementPrismaRepository } from '../wallets/infrastructure/deposit-settlement.prisma.repository';
import { LEDGER_REPOSITORY } from '../transactions/application/ports/ledger.repository.port';
import { LedgerPrismaRepository } from '../transactions/infrastructure/ledger.prisma.repository';

/**
 * Admin feature module (WN-5, BQ-1, BQ-2, CLAUDE.md §4 — listed as a planned module).
 *
 * Provides the internal admin surface for operator/ops tasks:
 *   - POST /admin/wallets/backfill-networks — enqueue async backfill (BQ-2).
 *   - GET  /admin/wallets/backfill-runs/:id — poll BackfillRun status (BQ-2).
 *   - GET  /admin/queues (Bull Board dashboard, BQ-1) — queue monitoring.
 *
 * Why WalletBackfillService lives here (not in WalletsModule):
 *   WalletBackfillService requires USER_LISTER (IUserLister) — the port whose
 *   adapter lives in identity/infrastructure. Registering it in WalletsModule
 *   would require WalletsModule to import IdentityModule, creating a cycle
 *   (IdentityModule already imports WalletsModule for WN-3). AdminModule is
 *   the composition root that safely imports both and provides all dependencies.
 *
 * Bull Board (BQ-1, BQ-2):
 *   Mounted at /admin/queues via @bull-board/nestjs + ExpressAdapter. Protected
 *   by BullBoardBasicAuthMiddleware (HTTP Basic auth, password = ADMIN_API_TOKEN).
 *   Both the echo queue and the wallet-backfill queue are registered.
 *
 * DI wiring:
 *   - WalletsModule: exports WalletService, WALLET_PROVIDER, WALLET_REPOSITORY,
 *     BACKFILL_RUN_REPOSITORY.
 *   - IdentityModule: exports USER_LISTER (ActiveUserListerPrismaAdapter).
 *   - CatalogModule is global — AssetRegistry available without import.
 *   - ConfigModule is global — ConfigService available for guards and middleware.
 *   - PrismaModule is global — PrismaService available without import.
 *   - JobsModule is imported at AppModule level with BullModule re-exported —
 *     BullBoardModule.forFeature() and @InjectQueue() resolve queues from BullModule.
 */
@Module({
  imports: [
    WalletsModule,
    IdentityModule,
    // Register the wallet-backfill queue in AdminModule so @InjectQueue resolves
    // for AdminWalletsController. BullModule.forRoot() is already set up by
    // JobsModule (imported at AppModule level); this registerQueue call adds the
    // Queue instance to AdminModule's DI scope without duplicating the connection.
    BullModule.registerQueue({ name: WALLET_BACKFILL_QUEUE_NAME }),
    // Bull Board root: ExpressAdapter + fail-closed Basic-auth middleware.
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
      middleware: BullBoardBasicAuthMiddleware,
    }),
    // Register all queues with Bull Board so they appear in the dashboard.
    BullBoardModule.forFeature({
      name: ECHO_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: WALLET_BACKFILL_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [AdminWalletsController],
  providers: [
    AdminTokenGuard,
    BullBoardBasicAuthMiddleware,
    // WalletBackfillService is provided here (not in WalletsModule) so it can
    // receive USER_LISTER from IdentityModule without creating a cycle.
    // Still needed by the coordinator processor via WorkerModule.
    WalletBackfillService,
    // WalletReconciliationService: registered here (not in WalletsModule) so it
    // can be wired alongside the existing DEPOSIT_SETTLEMENT_REPOSITORY and
    // LEDGER_REPOSITORY bindings without creating a cycle. Both repositories are
    // bound locally — PrismaService is global so they have no unmet dependencies.
    WalletReconciliationService,
    {
      provide: DEPOSIT_SETTLEMENT_REPOSITORY,
      useClass: DepositSettlementPrismaRepository,
    },
    {
      provide: LEDGER_REPOSITORY,
      useClass: LedgerPrismaRepository,
    },
  ],
})
export class AdminModule {}
