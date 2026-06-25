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

  // ── Asset lookups ──────────────────────────────────────────────────────

  /**
   * Returns metadata for the given asset symbol.
   * @throws {UnsupportedAssetError} when the symbol is not registered or is disabled.
   */
  asset(symbol: string): AssetMeta {
    const meta = this.catalog.assets[symbol];
    if (!meta || !meta.enabled) {
      throw new UnsupportedAssetError(symbol);
    }
    return meta;
  }

  /**
   * Returns `true` if the asset is registered AND enabled; `false` otherwise.
   * Safe to call without try/catch.
   */
  isAssetEnabled(symbol: string): boolean {
    const meta = this.catalog.assets[symbol];
    return !!meta?.enabled;
  }

  /**
   * Returns the provider-specific id (e.g. Blockradar asset UUID) for the asset.
   * @throws {UnsupportedAssetError} when the asset is not registered, disabled,
   *   or the requested provider entry is absent.
   */
  assetProviderId(symbol: string, provider: string): string {
    const meta = this.asset(symbol); // throws UnsupportedAssetError if absent/disabled
    const providerMeta = meta.providers[provider];
    if (!providerMeta) {
      throw new UnsupportedAssetError(
        symbol,
        `no provider binding for "${provider}"`,
      );
    }
    return providerMeta.assetId;
  }

  /**
   * Returns the symbol of the first enabled crypto asset in the catalog.
   * Used where a flow needs "the" launch asset without a hardcoded literal.
   * @throws {UnsupportedAssetError} when no enabled crypto asset is registered.
   */
  defaultCryptoAsset(): string {
    const symbol = Object.values(this.catalog.assets).find(
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
   * Used by the system-prompt builder and any UI that must enumerate supported
   * assets without hardcoding a list (registry-driven extensibility, §7).
   */
  enabledCryptoAssets(): string[] {
    return Object.values(this.catalog.assets)
      .filter((a) => a.enabled && a.kind === 'crypto')
      .map((a) => a.symbol);
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

    const assets = Object.values(this.catalog.assets)
      .filter((a) => a.enabled)
      .map(({ symbol, displayName, decimals, networks }) => ({
        symbol,
        displayName,
        decimals,
        // Only include enabled networks for this asset.
        networks: networks.filter((n) => this.isNetworkEnabled(n)),
      }));

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
