import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { WalletsModule } from '../wallets/wallets.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminTokenGuard } from './guards/admin-token.guard';
import { AdminWalletsController } from './presentation/admin-wallets.controller';
import { WalletBackfillService } from '../wallets/application/wallet-backfill.service';
import { BullBoardBasicAuthMiddleware } from './bull-board.middleware';
import { ECHO_QUEUE_NAME } from '../../core/jobs/echo-queue.constants';

/**
 * Admin feature module (WN-5, BQ-1, CLAUDE.md §4 — listed as a planned module).
 *
 * Provides the internal admin surface for operator/ops tasks:
 *   - POST /admin/wallets/backfill-networks — wallet network backfill (WN-5).
 *   - GET  /admin/queues (Bull Board dashboard, BQ-1) — queue monitoring.
 *
 * Why WalletBackfillService lives here (not in WalletsModule):
 *   WalletBackfillService requires USER_LISTER (IUserLister) — the port whose
 *   adapter lives in identity/infrastructure. Registering it in WalletsModule
 *   would require WalletsModule to import IdentityModule, creating a cycle
 *   (IdentityModule already imports WalletsModule for WN-3). AdminModule is
 *   the composition root that safely imports both and provides all dependencies.
 *
 * Bull Board (BQ-1):
 *   Mounted at /admin/queues via @bull-board/nestjs + ExpressAdapter. Protected
 *   by BullBoardBasicAuthMiddleware (HTTP Basic auth, password = ADMIN_API_TOKEN).
 *   Fail-closed: when ADMIN_API_TOKEN is unset, the dashboard returns 401 for
 *   every request — same principle as AdminTokenGuard on the REST admin endpoints.
 *
 * Swap seam (admin UI):
 *   When the admin UI + proper admin-session auth lands, replace
 *   BullBoardBasicAuthMiddleware in the BullBoardModule.forRoot options with the
 *   session-based middleware. The registered queues, route, and board stay unchanged.
 *   Also replace AdminTokenGuard on AdminWalletsController with the session guard.
 *
 * DI wiring:
 *   - WalletsModule: exports WalletService, WALLET_PROVIDER, WALLET_REPOSITORY.
 *   - IdentityModule: exports USER_LISTER (ActiveUserListerPrismaAdapter).
 *   - CatalogModule is global — AssetRegistry available without import.
 *   - ConfigModule is global — ConfigService available for guards and middleware.
 *   - PrismaModule is global — PrismaService available without import.
 *   - JobsModule is imported at AppModule level with BullModule re-exported —
 *     BullBoardModule.forFeature() below resolves the queue from BullModule.
 */
@Module({
  imports: [
    WalletsModule,
    IdentityModule,
    // Bull Board root: ExpressAdapter + fail-closed Basic-auth middleware.
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
      middleware: BullBoardBasicAuthMiddleware,
    }),
    // Register the echo queue (and all future queues) with the board.
    BullBoardModule.forFeature({
      name: ECHO_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [AdminWalletsController],
  providers: [
    AdminTokenGuard,
    BullBoardBasicAuthMiddleware,
    // WalletBackfillService is provided here (not in WalletsModule) so it can
    // receive USER_LISTER from IdentityModule without creating a cycle.
    WalletBackfillService,
  ],
})
export class AdminModule {}
