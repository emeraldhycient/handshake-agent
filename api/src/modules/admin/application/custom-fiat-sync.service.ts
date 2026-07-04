import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { CatalogFiat } from '../../../core/config/configuration';
import {
  CUSTOM_FIAT_REPOSITORY,
  type CustomFiatRecord,
  type ICustomFiatRepository,
} from './ports/custom-fiat.repository.port';

/**
 * CustomFiatSyncService — publishes the runtime custom-fiat overlay (the "Add
 * currency" feature) to the AssetRegistry, and thus to the WHOLE money path
 * (every fiat lookup consults the overlay). It reads all rows from the custom-fiat
 * store and calls `AssetRegistry.syncCustomFiats` with the mapped `CatalogFiat[]`.
 *
 * It runs on boot (OnModuleInit) so a persisted currency is recognised immediately,
 * and exposes a public `sync()` the admin currency service calls after every add or
 * update so a newly added / toggled currency reaches the overlay without a restart.
 *
 * A custom fiat never moves money (§3.1): the overlay only makes the currency
 * *recognised* — an entry stays `enabled: false` (fail-closed) until pricing is
 * configured and it is explicitly enabled (re-checked server-side, §3.3). The
 * `enabled` flag is carried through verbatim; the registry itself never shadows a
 * built-in fiat. Boot is resilient: a repo failure is logged and swallowed so a
 * transient DB issue never blocks startup — the overlay simply stays empty until the
 * next successful sync. Reaches the DB only through the injected port (§3.2).
 */
@Injectable()
export class CustomFiatSyncService implements OnModuleInit {
  private readonly logger = new Logger(CustomFiatSyncService.name);

  constructor(
    private readonly registry: AssetRegistry,
    @Inject(CUSTOM_FIAT_REPOSITORY)
    private readonly repo: ICustomFiatRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.sync();
    } catch (err: unknown) {
      // Boot resilience: a repo failure must never crash startup. The overlay
      // stays empty until the next successful sync (admin add/update re-drives it).
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'CustomFiatSync: failed to publish custom fiats at boot — overlay left empty',
      );
    }
  }

  /**
   * Reads all custom fiats and republishes them as the AssetRegistry overlay.
   * Called on boot and after every admin add/update so the money path always sees
   * the current set. Idempotent — `syncCustomFiats` replaces the overlay wholesale.
   */
  async sync(): Promise<void> {
    const rows = await this.repo.listAll();
    this.registry.syncCustomFiats(rows.map(toCatalogFiat));
  }
}

/** Projects a persisted custom-fiat record into the AssetRegistry overlay shape. */
function toCatalogFiat(row: CustomFiatRecord): CatalogFiat {
  return {
    code: row.code,
    displayName: row.displayName,
    symbol: row.symbol,
    decimals: row.decimals,
    enabled: row.enabled,
  };
}
