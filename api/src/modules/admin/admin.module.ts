import { Module } from '@nestjs/common';

import { WalletsModule } from '../wallets/wallets.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminTokenGuard } from './guards/admin-token.guard';
import { AdminWalletsController } from './presentation/admin-wallets.controller';
import { WalletBackfillService } from '../wallets/application/wallet-backfill.service';

/**
 * Admin feature module (WN-5, CLAUDE.md §4 — listed as a planned module).
 *
 * Provides the internal admin surface for operator/ops tasks.
 * At launch: the wallet network backfill endpoint (POST /admin/wallets/backfill-networks).
 *
 * Why WalletBackfillService lives here (not in WalletsModule):
 *   WalletBackfillService requires USER_LISTER (IUserLister) — the port whose
 *   adapter lives in identity/infrastructure. Registering it in WalletsModule
 *   would require WalletsModule to import IdentityModule, creating a cycle
 *   (IdentityModule already imports WalletsModule for WN-3). AdminModule is
 *   the composition root that safely imports both and provides all dependencies.
 *
 * DI wiring:
 *   - WalletsModule: exports WalletService, WALLET_PROVIDER, WALLET_REPOSITORY.
 *     All three are injected into WalletBackfillService.
 *   - IdentityModule: exports USER_LISTER (ActiveUserListerPrismaAdapter) and
 *     AssetRegistry (via CatalogModule, which is global). USER_LISTER is injected
 *     into WalletBackfillService.
 *   - CatalogModule is global — AssetRegistry is available without import.
 *   - ConfigModule is global — ConfigService available for AdminTokenGuard.
 *   - PrismaModule is global — PrismaService available without import.
 *
 * Guard swap seam (admin UI):
 *   When proper admin-session auth lands, replace AdminTokenGuard here and on
 *   AdminWalletsController with the session guard. The module/controller/service
 *   shape stays identical.
 */
@Module({
  imports: [WalletsModule, IdentityModule],
  controllers: [AdminWalletsController],
  providers: [
    AdminTokenGuard,
    // WalletBackfillService is provided here (not in WalletsModule) so it can
    // receive USER_LISTER from IdentityModule without creating a cycle.
    WalletBackfillService,
  ],
})
export class AdminModule {}
