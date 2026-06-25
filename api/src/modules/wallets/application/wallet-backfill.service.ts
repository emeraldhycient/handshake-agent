import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  BackfillNetworksRequest,
  BackfillReport,
} from '@handshake-agent/contracts';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { USER_LISTER, type IUserLister } from './ports/user-lister.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from './ports/wallet.repository.port';
import { WalletService } from './wallet.service';

/** Default page size for the user-id cursor scan. */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Presentation-agnostic service that backfills missing network wallet
 * addresses for existing users after a new network is enabled.
 *
 * Design (WN-5):
 *   - Pages ALL active users via IUserLister (injected port) — no direct DB
 *     access, no wallets→identity cycle (dep-cruiser rule: application layer
 *     owns the port interface; identity/infrastructure implements the adapter).
 *   - Per user (live mode): delegates to WalletService.provisionAllEnabledNetworks
 *     which is already idempotent — safe to call on users who already have
 *     all networks.
 *   - Per user (dryRun mode): inspects IWalletRepository.findByUserNetwork
 *     to tally which networks are missing without touching the provider.
 *   - Per-user error isolation: failures are logged + tallied; the batch
 *     continues so one bad user never aborts the run.
 *   - Returns a BackfillReport (shared contract from @handshake-agent/contracts)
 *     used identically by the CLI, the admin HTTP endpoint, and the future web UI.
 *
 * Admin UI hookup seam (WN-5 §4):
 *   AdminWalletsController calls this service via the same BackfillNetworksRequest
 *   DTO. When proper admin-session auth is built, swap AdminTokenGuard for a
 *   session/role guard — the controller, DTO, and this service stay unchanged.
 */
@Injectable()
export class WalletBackfillService {
  private readonly logger = new Logger(WalletBackfillService.name);

  constructor(
    @Inject(USER_LISTER)
    private readonly userLister: IUserLister,
    private readonly walletService: WalletService,
    private readonly assetRegistry: AssetRegistry,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: IWalletRepository,
  ) {}

  /**
   * Backfills missing network addresses for all active users.
   *
   * @param options.batchSize - Users per DB page (default 100).
   * @param options.dryRun    - When true, tallies missing wallets without
   *   calling the provider. Useful for scoping a run before committing.
   * @returns BackfillReport — counts and per-user failures.
   */
  async backfillMissingNetworkAddresses(
    options: Pick<BackfillNetworksRequest, 'batchSize' | 'dryRun'>,
  ): Promise<BackfillReport> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const dryRun = options.dryRun ?? false;
    const enabledNetworks = this.assetRegistry.enabledNetworks();

    // Initialise per-network tallies for all enabled networks.
    const perNetwork: BackfillReport['perNetwork'] = Object.fromEntries(
      enabledNetworks.map((n) => [n, { alreadyHad: 0, provisioned: 0 }]),
    );
    const failures: BackfillReport['failures'] = [];
    let usersScanned = 0;

    this.logger.log(
      `WN-5 backfill: starting (dryRun=${dryRun}, batchSize=${batchSize}, networks=[${enabledNetworks.join(', ')}])`,
    );

    let cursor: string | null = null;
    let pageNum = 0;

    // Keyset-cursor page scan — safe for very large user tables (no OFFSET drift).
    for (;;) {
      pageNum++;
      const page = await this.userLister.listActiveUserIds({
        cursor,
        limit: batchSize,
      });

      if (page.ids.length === 0) {
        this.logger.debug(
          `WN-5 backfill: page ${pageNum} empty — scan complete.`,
        );
        break;
      }

      this.logger.log(
        `WN-5 backfill: processing page ${pageNum} (${page.ids.length} users, cursor=${cursor ?? 'start'})`,
      );

      for (const userId of page.ids) {
        usersScanned++;
        try {
          if (dryRun) {
            await this.tallyDryRun(userId, enabledNetworks, perNetwork);
          } else {
            await this.provisionAndTally(userId, enabledNetworks, perNetwork);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`WN-5 backfill: user ${userId} failed — ${message}`);
          failures.push({ userId, error: message });
        }
      }

      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    const report: BackfillReport = { usersScanned, perNetwork, failures };

    this.logger.log(
      `WN-5 backfill: complete — scanned=${usersScanned}, failures=${failures.length}` +
        (dryRun ? ' [DRY RUN — no wallets created]' : ''),
    );

    return report;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Dry-run: check each network via the repo; tally alreadyHad / provisioned
   * without contacting the WaaS provider.
   */
  private async tallyDryRun(
    userId: string,
    enabledNetworks: string[],
    perNetwork: BackfillReport['perNetwork'],
  ): Promise<void> {
    for (const network of enabledNetworks) {
      const existing = await this.walletRepo.findByUserNetwork(userId, network);
      const tally = perNetwork[network];
      if (!tally) continue;
      if (existing !== null) {
        tally.alreadyHad++;
      } else {
        tally.provisioned++;
      }
    }
  }

  /**
   * Live run: snapshot per-network presence before provisioning, call
   * provisionAllEnabledNetworks (idempotent), then tally the delta.
   */
  private async provisionAndTally(
    userId: string,
    enabledNetworks: string[],
    perNetwork: BackfillReport['perNetwork'],
  ): Promise<void> {
    // Snapshot which networks already existed before provisioning.
    const preExisting = new Set<string>();
    for (const network of enabledNetworks) {
      const existing = await this.walletRepo.findByUserNetwork(userId, network);
      if (existing !== null) {
        preExisting.add(network);
      }
    }

    // Delegate to the idempotent provisioning method.
    await this.walletService.provisionAllEnabledNetworks(userId);

    // Tally based on the pre-existing snapshot.
    for (const network of enabledNetworks) {
      const tally = perNetwork[network];
      if (!tally) continue;
      if (preExisting.has(network)) {
        tally.alreadyHad++;
      } else {
        tally.provisioned++;
      }
    }
  }
}
