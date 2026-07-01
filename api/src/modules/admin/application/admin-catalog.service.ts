import { Injectable } from '@nestjs/common';

import type {
  AdminCatalogAsset,
  AdminCatalogFiat,
  AdminCatalogView,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { CatalogConfig } from '../../../core/config/configuration';

/**
 * Phase 6b — READ-ONLY admin catalog console. Projects the FULL asset + fiat
 * catalog (enabled AND disabled) for the Configuration group's Asset / Currency
 * catalog screens.
 *
 * Why not the public `GET /config`: `AssetRegistry.publicView()` filters to
 * *enabled* entries and strips secrets, so it cannot show the paused/off rows or
 * the per-entry live status the admin screens render. This service reads the
 * SAME merged, hot-reloaded snapshot the layered config exposes
 * (EffectiveConfigService — so a DB-admin `catalog.*.enabled` toggle is reflected
 * live) and surfaces only non-secret display metadata: symbol / display name /
 * chain(s) / decimals / live for assets, and code / symbol / name / rounding /
 * live for fiats. It NEVER surfaces provider ids, master-wallet ids, AML
 * blockchain tags, or address patterns (§3.4 / §7).
 *
 * It never moves money (§3.1) and holds no Prisma import — it reaches data only
 * through the injected layered-config service (§3.2). Live-status edits are Phase 7.
 */
@Injectable()
export class AdminCatalogService {
  constructor(private readonly effectiveConfig: EffectiveConfigService) {}

  /** The full (enabled + disabled) asset + fiat catalog, secret-stripped. */
  getCatalog(): AdminCatalogView {
    const catalog = this.effectiveConfig.get<CatalogConfig>('catalog');

    const assets: AdminCatalogAsset[] = Object.values(catalog.assets).map(
      (a) => ({
        symbol: a.symbol,
        displayName: a.displayName,
        kind: a.kind,
        decimals: a.decimals,
        networks: a.networks.map((id) => this.networkLabel(catalog, id)),
        live: a.enabled,
      }),
    );

    const fiats: AdminCatalogFiat[] = Object.values(catalog.fiats).map((f) => ({
      code: f.code,
      symbol: f.symbol,
      displayName: f.displayName,
      decimals: f.decimals,
      live: f.enabled,
    }));

    return { assets, fiats };
  }

  /**
   * Resolves a network id to its display label, falling back to the id itself
   * when the network is not registered in `catalog.networks` (so a listing on an
   * unconfigured chain still renders instead of vanishing).
   */
  private networkLabel(catalog: CatalogConfig, id: string): string {
    return catalog.networks[id]?.displayName ?? id;
  }
}
