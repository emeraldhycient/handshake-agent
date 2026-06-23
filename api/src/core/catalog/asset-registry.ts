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

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Per-provider metadata for an asset (e.g. Blockradar asset id). */
export interface AssetProviderMeta {
  assetId: string;
}

/** Crypto asset metadata. */
export interface AssetMeta {
  symbol: string;
  displayName: string;
  kind: 'crypto';
  decimals: number;
  networks: string[];
  providers: Record<string, AssetProviderMeta>;
  enabled: boolean;
}

/** Fiat currency metadata. */
export interface FiatMeta {
  code: string;
  displayName: string;
  /** Currency symbol for display (e.g. '₦'). */
  symbol: string;
  decimals: number;
  enabled: boolean;
}

/** Blockchain network metadata. */
export interface NetworkMeta {
  id: string;
  displayName: string;
  /** Regex pattern for validating on-chain addresses on this network. */
  addressPattern: string;
  enabled: boolean;
}

/** Catalog section shape as stored in the layered config (configuration.ts). */
export interface CatalogConfig {
  assets: Record<string, AssetMeta>;
  fiats: Record<string, FiatMeta>;
  networks: Record<string, NetworkMeta>;
  capabilities: Record<string, boolean>;
}

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

  constructor(private readonly config: ConfigService) {
    const catalog = this.config.get<CatalogConfig>('catalog');
    if (!catalog) {
      throw new Error(
        'AssetRegistry: "catalog" config section is missing. ' +
          'Ensure the catalog block is present in configuration.ts.',
      );
    }
    this.catalog = catalog;
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
   * Validates an on-chain address against the network's configured regex pattern.
   * @throws {UnsupportedNetworkError} when the network is not registered.
   */
  validateAddress(networkId: string, address: string): boolean {
    const meta = this.network(networkId); // throws if unknown
    return new RegExp(meta.addressPattern).test(address);
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
   * @throws {UnsupportedFiatError} when the fiat code is not registered.
   */
  formatFiat(code: string, amount: string): string {
    const meta = this.fiat(code); // validates the fiat exists
    const num = parseFloat(amount);
    const formatted = num.toLocaleString('en-NG', {
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals,
    });
    return `${meta.symbol}${formatted}`;
  }
}
