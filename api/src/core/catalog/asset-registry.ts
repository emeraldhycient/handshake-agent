/**
 * AssetRegistry — config-driven registry for crypto assets, fiat currencies,
 * and blockchain networks (task X1, CLAUDE.md §7).
 *
 * Single source of truth for asset/fiat/network metadata and capability flags.
 * Reads from the `catalog` section of the layered config. New assets, fiats,
 * and networks are config entries — not code changes.
 *
 * This service is pure-ish: no DB access, no network calls, no side effects.
 * It can be instantiated directly in tests (no Nest test bed required).
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  UnsupportedAssetError,
  UnsupportedFiatError,
  UnsupportedNetworkError,
  CapabilityDisabledError,
} from './catalog-errors';

import type {
  AssetProviderConfig,
  CatalogAsset,
  CatalogConfig,
  CatalogFiat,
  CatalogNetwork,
} from '../config/configuration';

import type { PublicConfigResponse } from '@handshake-agent/contracts';
import type { DiscoveredAsset } from '../../modules/wallets/application/ports/wallet-provider.port';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// The catalog shapes live canonically in the JSON-defaults config
// (configuration.ts §catalog). They are re-exported here under the registry's
// domain-facing `*Meta` names so callers keep a single source of truth — the
// same shape is never redefined twice (root CLAUDE.md §13 rule 2, DRY).

/** Per-provider metadata for an asset (e.g. Blockradar asset id). */
export type AssetProviderMeta = AssetProviderConfig;

/** Crypto asset metadata. */
export type AssetMeta = CatalogAsset;

/** Fiat currency metadata. */
export type FiatMeta = CatalogFiat;

/** Blockchain network metadata. */
export type NetworkMeta = CatalogNetwork;

/** Catalog section shape as stored in the layered config (configuration.ts). */
export type { CatalogConfig };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Injectable service that exposes metadata lookups and capability checks for
 * the asset/fiat/network catalog. Throw typed errors for unknown/disabled
 * entries so callers can surface actionable messages.
 */
@Injectable()
export class AssetRegistry {
  private readonly catalog: CatalogConfig;

  /**
   * Pre-compiled address validation RegExps per network id.
   * Built once in the constructor so `validateAddress` never constructs a
   * new RegExp on each call (avoids per-call compilation cost and ReDoS
   * amplification on hot paths).
   */
  private readonly addressRegExps: Map<string, RegExp>;

  /**
   * Overlay of provider asset ids discovered at runtime by CatalogSyncService.
   * Keyed by SYMBOL (upper-case) → provider name → assetId.
   *
   * This overlay is checked FIRST in `assetProviderId()`.  The config-layer
   * providers map (CatalogAsset.providers) acts as a static fallback for cases
   * where the sync has not yet run or returned nothing.
   *
   * Using a separate overlay (rather than mutating `catalog`) means the static
   * config type remains immutable after construction, and the sync can safely
   * call `mergeDiscoveredAssets()` concurrently without locking.
   */
  private readonly discoveredProviderIds: Map<string, Record<string, string>> =
    new Map();

  /**
   * Overlay of discovered asset metadata (decimals, name, networks list).
   * Populated by CatalogSyncService so assets found on-chain but absent from
   * the static config are still accessible (enabled=true by default when discovered).
   *
   * Keyed by symbol (upper-case). Only populated for assets NOT already in the
   * static catalog — discovered assets that match a static entry enrich the
   * provider-id overlay only.
   */
  private readonly discoveredAssets: Map<string, CatalogAsset> = new Map();

  constructor(private readonly config: ConfigService) {
    const catalog = this.config.get<CatalogConfig>('catalog');
    if (!catalog) {
      throw new Error(
        'AssetRegistry: "catalog" config section is missing. ' +
          'Ensure the catalog block is present in configuration.ts.',
      );
    }
    this.catalog = catalog;

    // Compile one RegExp per network at construction time.
    this.addressRegExps = new Map(
      Object.entries(catalog.networks).map(([id, net]) => [
        id,
        new RegExp(net.addressPattern),
      ]),
    );
  }

  // ── Dynamic asset sync ────────────────────────────────────────────────────

  /**
   * Merges provider-discovered assets into the registry.
   * Called by CatalogSyncService on boot (OnModuleInit) and on admin refresh.
   *
   * For each discovered asset:
   *   - If the symbol already exists in the static config catalog, the discovered
   *     `assetId` is stored in the `discoveredProviderIds` overlay so that
   *     `assetProviderId(symbol, 'blockradar')` returns the real runtime id.
   *   - If the symbol is NOT in the static catalog, a synthetic CatalogAsset entry
   *     is built from the discovered metadata and stored in `discoveredAssets`,
   *     making `asset(symbol)` and `enabledCryptoAssets()` see it.
   *
   * Assets with a network not present in `catalog.networks` are skipped with a
   * debug note (the network must be configured statically — NETWORKS stay config).
   */
  mergeDiscoveredAssets(assets: DiscoveredAsset[]): void {
    for (const discovered of assets) {
      const sym = discovered.symbol.toUpperCase();
      const networkId = discovered.network.toUpperCase();

      // Skip assets on networks not registered in the static config.
      // Networks stay config-driven; dynamic network discovery is not in scope.
      if (!this.catalog.networks[networkId]) {
        continue;
      }

      // Update the provider-id overlay for 'blockradar'.
      const existing = this.discoveredProviderIds.get(sym) ?? {};
      existing['blockradar'] = discovered.assetId;
      this.discoveredProviderIds.set(sym, existing);

      // If the symbol is not in the static catalog, synthesise a CatalogAsset.
      if (!this.catalog.assets[sym] && !this.discoveredAssets.has(sym)) {
        const synthetic: CatalogAsset = {
          symbol: sym,
          displayName: discovered.name,
          kind: 'crypto',
          decimals: discovered.decimals,
          networks: [networkId],
          // providers populated via the discoveredProviderIds overlay
          providers: {},
          enabled: true,
        };
        this.discoveredAssets.set(sym, synthetic);
      } else if (this.discoveredAssets.has(sym)) {
        // Accumulate networks for the synthetic entry (multi-network asset).
        const synth = this.discoveredAssets.get(sym)!;
        if (!synth.networks.includes(networkId)) {
          synth.networks = [...synth.networks, networkId];
        }
      }
    }
  }

  // ── Asset lookups ──────────────────────────────────────────────────────

  /**
   * Returns metadata for the given asset symbol.
   *
   * Resolution order:
   *   1. Static config catalog (catalog.assets[symbol]) — config-layer entry wins.
   *   2. Discovered assets overlay (discoveredAssets) — synthesised at sync time for
   *      assets found on-chain but absent from the static config.
   *
   * @throws {UnsupportedAssetError} when the symbol is not in either source or is disabled.
   */
  asset(symbol: string): AssetMeta {
    const staticMeta = this.catalog.assets[symbol];
    if (staticMeta) {
      if (!staticMeta.enabled) throw new UnsupportedAssetError(symbol);
      return staticMeta;
    }
    const discovered = this.discoveredAssets.get(symbol);
    if (discovered && discovered.enabled) return discovered;
    throw new UnsupportedAssetError(symbol);
  }

  /**
   * Returns `true` if the asset is registered AND enabled; `false` otherwise.
   * Safe to call without try/catch.
   */
  isAssetEnabled(symbol: string): boolean {
    const staticMeta = this.catalog.assets[symbol];
    if (staticMeta !== undefined) return !!staticMeta.enabled;
    return !!this.discoveredAssets.get(symbol)?.enabled;
  }

  /**
   * Returns the provider-specific id (e.g. Blockradar asset UUID) for the asset.
   *
   * Resolution order for the provider id:
   *   1. discoveredProviderIds overlay — populated by CatalogSyncService at boot
   *      (the correct runtime id from the actual Blockradar wallet).
   *   2. Static config catalog providers map — fallback for when the sync has not
   *      yet run (e.g. test environments that stub the registry directly).
   *
   * @throws {UnsupportedAssetError} when the asset is not registered, disabled,
   *   or the requested provider entry is absent in both sources.
   */
  assetProviderId(symbol: string, provider: string): string {
    this.asset(symbol); // throws UnsupportedAssetError if absent/disabled

    // 1. Check the dynamic overlay first (runtime-discovered ids take precedence).
    const overlayProviders = this.discoveredProviderIds.get(symbol);
    if (overlayProviders?.[provider] !== undefined) {
      return overlayProviders[provider];
    }

    // 2. Fall back to the static config providers map.
    const staticMeta = this.catalog.assets[symbol];
    const providerMeta: AssetProviderConfig | undefined =
      staticMeta?.providers[provider];
    if (providerMeta) {
      return providerMeta.assetId;
    }

    throw new UnsupportedAssetError(
      symbol,
      `no provider binding for "${provider}"`,
    );
  }

  /**
   * Returns the symbol of the first enabled crypto asset in the catalog.
   * Checks static config assets first, then discovered assets.
   * Used where a flow needs "the" launch asset without a hardcoded literal.
   * @throws {UnsupportedAssetError} when no enabled crypto asset is registered.
   */
  defaultCryptoAsset(): string {
    const symbol =
      Object.values(this.catalog.assets).find(
        (a) => a.enabled && a.kind === 'crypto',
      )?.symbol ??
      Array.from(this.discoveredAssets.values()).find(
        (a) => a.enabled && a.kind === 'crypto',
      )?.symbol;
    if (!symbol) {
      throw new UnsupportedAssetError(
        'default',
        'no enabled crypto asset registered in the catalog',
      );
    }
    return symbol;
  }

  /**
   * Returns the first enabled network registered for the asset.
   * @throws {UnsupportedAssetError} when the asset is not registered or has no enabled networks.
   */
  defaultNetworkFor(symbol: string): string {
    const meta = this.asset(symbol);
    const enabled = meta.networks.filter((n) => this.isNetworkEnabled(n));
    if (enabled.length === 0) {
      throw new UnsupportedAssetError(
        symbol,
        'no enabled networks registered for this asset',
      );
    }
    return enabled[0];
  }

  // ── Fiat lookups ───────────────────────────────────────────────────────

  /**
   * Returns metadata for the given fiat currency code.
   * @throws {UnsupportedFiatError} when the code is not registered or is disabled.
   */
  fiat(code: string): FiatMeta {
    const meta = this.catalog.fiats[code];
    if (!meta || !meta.enabled) {
      throw new UnsupportedFiatError(code);
    }
    return meta;
  }

  /**
   * Returns the code of the first enabled fiat in the catalog — the base/settlement
   * fiat used to value crypto-only flows (send/swap) for the KYC + Travel-Rule gates.
   * @throws {UnsupportedFiatError} when no enabled fiat is registered.
   */
  defaultFiat(): string {
    const code = Object.values(this.catalog.fiats).find((f) => f.enabled)?.code;
    if (!code) {
      throw new UnsupportedFiatError(
        'default',
        'no enabled fiat registered in the catalog',
      );
    }
    return code;
  }

  /**
   * Returns `true` if the fiat is registered AND enabled; `false` otherwise.
   */
  isFiatEnabled(code: string): boolean {
    const meta = this.catalog.fiats[code];
    return !!meta?.enabled;
  }

  /**
   * Returns `true` if the fiat code is registered AND enabled in the catalog.
   * Semantically equivalent to `isFiatEnabled` but named for the multi-currency
   * foundation where "live" means the currency can settle real transactions.
   *
   * Non-live currencies are in the FiatCurrencySchema supported set (contracts)
   * but have `enabled: false` in config — their flows surface `currency_not_live`.
   */
  isCurrencyLive(code: string): boolean {
    const meta = this.catalog.fiats[code];
    return !!meta?.enabled;
  }

  /**
   * Returns the fiat codes for all currencies that are currently LIVE
   * (i.e. registered in the catalog with `enabled: true`).
   *
   * Use this when you need to enumerate what the system can settle today.
   * For the full supported set (including not-yet-live currencies), use
   * `supportedFiats()`.
   */
  enabledFiats(): string[] {
    return Object.values(this.catalog.fiats)
      .filter((f) => f.enabled)
      .map((f) => f.code);
  }

  /**
   * Returns the fiat codes for ALL currencies registered in the catalog,
   * regardless of their `enabled` flag. This is the config-layer equivalent
   * of the `FiatCurrencySchema` enum in `@handshake-agent/contracts`.
   *
   * Use this when you need to recognise a currency without asserting liveness
   * (e.g. to emit `currency_not_live` rather than rejecting as unknown).
   */
  supportedFiats(): string[] {
    return Object.keys(this.catalog.fiats);
  }

  // ── Network lookups ───────────────────────────────────────────────────

  /**
   * Returns metadata for the given network id.
   * @throws {UnsupportedNetworkError} when the id is not registered or is disabled.
   */
  network(id: string): NetworkMeta {
    const meta = this.catalog.networks[id];
    if (!meta || !meta.enabled) {
      throw new UnsupportedNetworkError(id);
    }
    return meta;
  }

  /**
   * Returns `true` if the network is registered AND enabled; `false` otherwise.
   */
  isNetworkEnabled(id: string): boolean {
    const meta = this.catalog.networks[id];
    return !!meta?.enabled;
  }

  /**
   * Returns an array of all enabled network ids in the catalog.
   * Used by `provisionAllEnabledNetworks` to iterate over supported networks
   * without hardcoding them in the service (registry-driven extensibility, §7).
   */
  enabledNetworks(): string[] {
    return Object.entries(this.catalog.networks)
      .filter(([, net]) => net.enabled)
      .map(([id]) => id);
  }

  /**
   * Returns an array of symbols for all enabled crypto assets in the catalog.
   * Includes both statically configured and dynamically discovered assets.
   * Discovered assets that duplicate a static entry are not double-counted.
   * Used by the system-prompt builder and any UI that must enumerate supported
   * assets without hardcoding a list (registry-driven extensibility, §7).
   */
  enabledCryptoAssets(): string[] {
    const staticSymbols = Object.values(this.catalog.assets)
      .filter((a) => a.enabled && a.kind === 'crypto')
      .map((a) => a.symbol);
    const discoveredSymbols = Array.from(this.discoveredAssets.values())
      .filter((a) => a.enabled && a.kind === 'crypto')
      .map((a) => a.symbol)
      .filter((sym) => !this.catalog.assets[sym]);
    return [...staticSymbols, ...discoveredSymbols];
  }

  /**
   * Returns the Blockradar master wallet id configured for the given network.
   *
   * Resolves from `catalog.networks[networkId].masterWalletId` which is populated
   * from env at boot (BLOCKRADAR_MASTER_WALLET_TRON or BLOCKRADAR_MASTER_WALLET_ID
   * for TRON; other networks use BLOCKRADAR_MASTER_WALLET_<NETWORK>). New networks
   * only need a config entry — no code change here.
   *
   * @throws {UnsupportedNetworkError} when the network is not registered or disabled.
   * @throws {Error} when the network has no configured master wallet id.
   */
  networkMasterWalletId(networkId: string): string {
    const meta = this.network(networkId); // throws UnsupportedNetworkError if absent/disabled
    if (!meta.masterWalletId) {
      throw new Error(
        `AssetRegistry: network "${networkId}" has no configured master wallet id. ` +
          `Set BLOCKRADAR_MASTER_WALLET_${networkId} or BLOCKRADAR_MASTER_WALLET_ID in env.`,
      );
    }
    return meta.masterWalletId;
  }

  /**
   * Validates an on-chain address against the network's configured regex pattern.
   * Uses a pre-compiled RegExp cached in the constructor — no per-call compilation.
   * @throws {UnsupportedNetworkError} when the network is not registered or disabled.
   */
  validateAddress(networkId: string, address: string): boolean {
    this.network(networkId); // throws if unknown/disabled
    // The RegExp was compiled for every network at construction time. The
    // defensive fallback (no match) is unreachable in practice but keeps TS happy.
    const re = this.addressRegExps.get(networkId);
    return re ? re.test(address) : false;
  }

  /**
   * Returns the id of the first registered network whose `addressPattern`
   * matches the given address, or `null` when no network matches.
   *
   * Reuses the pre-compiled RegExps built in the constructor — no per-call
   * `new RegExp` construction. No hardcoded network/asset literals.
   */
  inferNetworkForAddress(address: string): string | null {
    for (const [id, re] of this.addressRegExps.entries()) {
      if (re.test(address)) return id;
    }
    return null;
  }

  /**
   * Returns the symbol of the first enabled crypto asset whose default network
   * is the given `networkId`, or `null` when no such asset is registered.
   *
   * Checks static config assets first, then discovered assets.
   * Derives everything from the registry data — no hardcoded literals.
   */
  defaultAssetForNetwork(networkId: string): string | null {
    const staticAsset = Object.values(this.catalog.assets).find((a) => {
      if (!a.enabled || a.kind !== 'crypto') return false;
      const enabled = a.networks.filter((n) => this.isNetworkEnabled(n));
      return enabled[0] === networkId;
    });
    if (staticAsset) return staticAsset.symbol;

    const discovered = Array.from(this.discoveredAssets.values()).find((a) => {
      if (!a.enabled || a.kind !== 'crypto') return false;
      const enabled = a.networks.filter((n) => this.isNetworkEnabled(n));
      return enabled[0] === networkId;
    });
    return discovered ? discovered.symbol : null;
  }

  // ── Capability flags ──────────────────────────────────────────────────

  /**
   * Returns `true` if the capability flag is explicitly `true` in config.
   * Returns `false` for unknown capabilities (fail-closed).
   */
  isCapabilityEnabled(capability: string): boolean {
    return this.catalog.capabilities[capability] === true;
  }

  /**
   * Asserts that the capability is enabled.
   * @throws {CapabilityDisabledError} when the capability is disabled or unknown.
   */
  requireCapability(capability: string): void {
    if (!this.isCapabilityEnabled(capability)) {
      throw new CapabilityDisabledError(capability);
    }
  }

  // ── Public config view ────────────────────────────────────────────────

  /**
   * Projects ONLY enabled entries to the non-secret `PublicConfigResponse`
   * shape, stripping ALL secret / infra fields:
   *   - `providers` (contains Blockradar `assetId`)
   *   - `masterWalletId`
   *   - `amlBlockchain`
   *   - `addressPattern`
   *   - `networkFeeCrypto`
   *
   * This method is pure (no DB, no network calls, no side effects) and is
   * consumed by PublicConfigController to produce `GET /config` responses.
   * The controller additionally runs the result through
   * `PublicConfigResponseSchema.parse()` to strip any future drift before
   * sending over the wire.
   */
  publicView(): PublicConfigResponse {
    const fiats = Object.values(this.catalog.fiats)
      .filter((f) => f.enabled)
      .map(({ code, displayName, symbol, decimals }) => ({
        code,
        displayName,
        symbol,
        decimals,
      }));

    const staticAssets = Object.values(this.catalog.assets)
      .filter((a) => a.enabled)
      .map(({ symbol, displayName, decimals, networks }) => ({
        symbol,
        displayName,
        decimals,
        // Only include enabled networks for this asset.
        networks: networks.filter((n) => this.isNetworkEnabled(n)),
      }));

    const staticSymbolSet = new Set(Object.keys(this.catalog.assets));
    const discoveredPublicAssets = Array.from(this.discoveredAssets.values())
      .filter((a) => a.enabled && !staticSymbolSet.has(a.symbol))
      .map(({ symbol, displayName, decimals, networks }) => ({
        symbol,
        displayName,
        decimals,
        networks: networks.filter((n) => this.isNetworkEnabled(n)),
      }));

    const assets = [...staticAssets, ...discoveredPublicAssets];

    const networks = Object.values(this.catalog.networks)
      .filter((n) => n.enabled)
      .map(({ id, displayName }) => ({ id, displayName }));

    const capabilities = { ...this.catalog.capabilities };

    return { fiats, assets, networks, capabilities };
  }

  // ── Display formatters ────────────────────────────────────────────────

  /**
   * Formats a crypto amount for display: `"<amount> <SYMBOL>"`.
   * e.g. `formatCrypto('USDT', '3.5')` → `'3.5 USDT'`
   *
   * @throws {UnsupportedAssetError} when the asset is not registered.
   */
  formatCrypto(symbol: string, amount: string): string {
    const meta = this.asset(symbol); // validates the asset exists
    return `${amount} ${meta.symbol}`;
  }

  /**
   * Formats a fiat amount for display using the currency's symbol and decimal places.
   * e.g. `formatFiat('NGN', '5000')` → `'₦5,000.00'`
   *
   * Uses a deterministic manual formatter (no Intl/toLocaleString) so the output
   * is identical across all Node ICU builds (small-icu in Alpine/Docker CI vs
   * full ICU in local dev). This avoids test flakiness when the locale data
   * differs between environments.
   *
   * @throws {UnsupportedFiatError} when the fiat code is not registered.
   */
  formatFiat(code: string, amount: string): string {
    const meta = this.fiat(code); // validates the fiat exists
    const fixed = parseFloat(amount).toFixed(meta.decimals);
    const [intPart, fracPart] = fixed.split('.');
    // Insert thousand-separator commas: match a position preceded by at least one
    // digit and followed by groups of three digits to the end of the string.
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fracPart
      ? `${meta.symbol}${grouped}.${fracPart}`
      : `${meta.symbol}${grouped}`;
  }
}
