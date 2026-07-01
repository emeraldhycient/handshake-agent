import type { AssetRegistry } from '../../src/core/catalog/asset-registry';
import type { DiscoveredAsset } from '../../src/modules/wallets/application/ports/wallet-provider.port';

/**
 * Seeds the AssetRegistry's provider-id overlay with the standard testnet assets
 * (USDT + native TRX on TRON), mirroring what CatalogSyncService.refresh() does on
 * boot in production.
 *
 * Unit-style e2e tests either hand-roll the AssetRegistry (no CatalogSync at all) or
 * boot AppModule without a real Blockradar master-wallet id (so CatalogSync skips the
 * network). Either way the `blockradar` provider-id overlay stays empty, and any
 * withdraw-path code — `assetProviderId(asset, 'blockradar')` — throws
 * `UnsupportedAssetError: no provider binding for "blockradar"`. Call this once after
 * the registry is available to make the registry behave as it does after boot.
 */
export function seedRegistryAssets(registry: AssetRegistry): void {
  const assets: DiscoveredAsset[] = [
    {
      assetId: 'e2e-usdt-tron-asset-id',
      symbol: 'USDT',
      name: 'Tether USD',
      network: 'TRON',
      contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      isMainnet: false,
    },
    {
      assetId: 'e2e-trx-tron-asset-id',
      symbol: 'TRX',
      name: 'TRON',
      network: 'TRON',
      contractAddress: null,
      decimals: 6,
      isMainnet: false,
    },
  ];
  registry.mergeDiscoveredAssets(assets);
}
