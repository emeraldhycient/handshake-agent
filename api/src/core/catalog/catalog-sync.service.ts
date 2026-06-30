/**
 * CatalogSyncService — discovers assets from the configured wallet provider on
 * boot and merges them into the AssetRegistry's dynamic asset set.
 *
 * Design (CLAUDE.md §7 / directive):
 *   - Runs once on module init (OnModuleInit) per enabled network.
 *   - For each network's master wallet, calls provider.listWalletAssets().
 *   - Merges discovered assets into AssetRegistry keyed by symbol.
 *   - Resilient: failures are logged and swallowed — boot must never crash.
 *   - Exposes refresh() for an admin-triggered re-sync without restart.
 *
 * The provider is the WALLET_PROVIDER token (IWalletProvider), injected at
 * construction so the mock adapter serves tests and WALLET_MOCK_MODE boots.
 */

import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';

import { AssetRegistry } from './asset-registry';
import { WALLET_PROVIDER } from '../../modules/wallets/application/ports/wallet-provider.port';
import type { IWalletProvider } from '../../modules/wallets/application/ports/wallet-provider.port';

@Injectable()
export class CatalogSyncService implements OnModuleInit {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly registry: AssetRegistry,
    @Inject(WALLET_PROVIDER) private readonly provider: IWalletProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /**
   * Re-discovers assets for all enabled networks and merges them into the
   * AssetRegistry.  Safe to call at any time (admin trigger, test hook).
   *
   * Resilient: per-network errors are caught and logged; other networks still
   * proceed.  A total failure still never crashes the process.
   */
  async refresh(): Promise<void> {
    const networks = this.registry.enabledNetworks();

    for (const networkId of networks) {
      let masterWalletId: string;
      try {
        masterWalletId = this.registry.networkMasterWalletId(networkId);
      } catch (err: unknown) {
        // No master wallet configured for this network — skip gracefully.
        this.logger.warn(
          `CatalogSync: skipping network "${networkId}" — no master wallet id configured: ${String(err)}`,
        );
        continue;
      }

      if (!masterWalletId) {
        this.logger.warn(
          `CatalogSync: skipping network "${networkId}" — master wallet id is empty`,
        );
        continue;
      }

      try {
        const assets = await this.provider.listWalletAssets(masterWalletId);
        this.logger.log(
          `CatalogSync: discovered ${assets.length} asset(s) on network "${networkId}" (wallet ${masterWalletId})`,
        );
        this.registry.mergeDiscoveredAssets(assets);
      } catch (err: unknown) {
        // Resilient: provider error must never crash boot.
        this.logger.error(
          `CatalogSync: failed to fetch assets for network "${networkId}" (wallet ${masterWalletId}): ${String(err)}`,
        );
      }
    }
  }
}
