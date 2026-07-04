import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminCatalogAsset,
  AdminCatalogFiat,
  AdminCatalogView,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
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
 * The assets view is the UNION of the static catalog assets (from the layered config)
 * and the provider-DISCOVERED assets not yet in that static catalog (from the
 * AssetRegistry overlay, populated by CatalogSyncService against Blockradar). Discovered
 * assets are auto-enabled in the money-path overlay, so surfacing them keeps this screen
 * an honest view of the *effective* catalog — an operator sees every tradeable asset,
 * not just the statically-configured ones. Each row also carries the provider-discovered
 * `logoUrl` (Blockradar Cloudinary, or null → text-badge fallback); the URL is a public
 * image, never a secret.
 *
 * The currencies view is the UNION of the built-in catalog fiats (from the layered
 * config, `custom: false`) and the runtime admin-added custom fiats (from the
 * CustomFiat store, `custom: true`) — so a single screen shows both, each with its
 * effective `live` status. The custom rows are read straight from the store (not the
 * enabled-only overlay) so PAUSED custom currencies still appear. Reads the store only
 * through the injected port (§3.2); it never moves money (§3.1).
 */
/**
 * Kind assigned to a provider-discovered asset. Blockradar discovers on-chain crypto
 * assets, so a genuinely-new discovery (absent from the static config, which is where a
 * `kind` would otherwise be declared) is a crypto asset by definition.
 */
const DISCOVERED_ASSET_KIND = 'crypto';

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly effectiveConfig: EffectiveConfigService,
    private readonly registry: AssetRegistry,
    @Inject(CUSTOM_FIAT_REPOSITORY)
    private readonly customFiats: ICustomFiatRepository,
  ) {}

  /** The full (enabled + disabled) asset + fiat catalog, built-ins + custom, secret-stripped. */
  async getCatalog(): Promise<AdminCatalogView> {
    const catalog = this.effectiveConfig.get<CatalogConfig>('catalog');

    // Static catalog assets, each enriched with its discovered logo (if any).
    const staticAssets: AdminCatalogAsset[] = Object.values(catalog.assets).map(
      (a) => ({
        symbol: a.symbol,
        displayName: a.displayName,
        kind: a.kind,
        decimals: a.decimals,
        networks: a.networks.map((id) => this.networkLabel(catalog, id)),
        live: a.enabled,
        logoUrl: this.registry.logoUrl(a.symbol),
      }),
    );

    // Provider-discovered assets NOT yet in the static catalog (auto-enabled in the
    // money path) — surfaced so the table reflects the effective tradeable catalog.
    const discoveredAssets: AdminCatalogAsset[] = this.registry
      .listDiscoveredAssets()
      .filter((d) => !d.inStaticCatalog)
      .map((d) => ({
        symbol: d.symbol,
        displayName: d.displayName,
        kind: DISCOVERED_ASSET_KIND,
        decimals: d.decimals,
        networks: d.networks.map((id) => this.networkLabel(catalog, id)),
        live: d.enabled,
        logoUrl: d.logoUrl,
      }));

    const assets: AdminCatalogAsset[] = [...staticAssets, ...discoveredAssets];

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
