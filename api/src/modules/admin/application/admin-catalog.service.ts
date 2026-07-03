import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminCatalogAsset,
  AdminCatalogFiat,
  AdminCatalogView,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { CatalogConfig } from '../../../core/config/configuration';
import {
  CUSTOM_FIAT_REPOSITORY,
  type CustomFiatRecord,
  type ICustomFiatRepository,
} from './ports/custom-fiat.repository.port';

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
 * The currencies view is the UNION of the built-in catalog fiats (from the layered
 * config, `custom: false`) and the runtime admin-added custom fiats (from the
 * CustomFiat store, `custom: true`) — so a single screen shows both, each with its
 * effective `live` status. The custom rows are read straight from the store (not the
 * enabled-only overlay) so PAUSED custom currencies still appear. Reads the store only
 * through the injected port (§3.2); it never moves money (§3.1).
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly effectiveConfig: EffectiveConfigService,
    @Inject(CUSTOM_FIAT_REPOSITORY)
    private readonly customFiats: ICustomFiatRepository,
  ) {}

  /** The full (enabled + disabled) asset + fiat catalog, built-ins + custom, secret-stripped. */
  async getCatalog(): Promise<AdminCatalogView> {
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

    // Built-in fiats (from the layered config) — never a runtime custom currency.
    const builtinFiats: AdminCatalogFiat[] = Object.values(catalog.fiats).map(
      (f) => ({
        code: f.code,
        symbol: f.symbol,
        displayName: f.displayName,
        decimals: f.decimals,
        live: f.enabled,
        custom: false,
      }),
    );

    // Runtime admin-added custom fiats (from the store) — includes paused rows.
    const customRows = await this.customFiats.listAll();
    const customFiats: AdminCatalogFiat[] = customRows.map(toCustomCatalogFiat);

    return { assets, fiats: [...builtinFiats, ...customFiats] };
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

/** Projects a stored custom-fiat record into the admin catalog fiat row (custom: true). */
function toCustomCatalogFiat(row: CustomFiatRecord): AdminCatalogFiat {
  return {
    code: row.code,
    symbol: row.symbol,
    displayName: row.displayName,
    decimals: row.decimals,
    live: row.enabled,
    custom: true,
  };
}
