import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  AdminAssetsSyncResponse,
  AdminDiscoveredAsset,
  AdminDiscoveredAssetListResponse,
} from '@handshake-agent/contracts';

import {
  AssetRegistry,
  type DiscoveredAssetView,
} from '../../../core/catalog/asset-registry';
import { CatalogSyncService } from '../../../core/catalog/catalog-sync.service';
import { AuditService } from '../../../core/audit/application/audit.service';

/**
 * AdminAssetsService — the asset-catalog DISCOVERY surface (CLAUDE.md §7). It exposes the
 * Blockradar-driven discovery that already runs at boot (CatalogSyncService) so an
 * operator can re-sync on demand and review what the provider found:
 *
 *   - `listDiscovered()` — the newly-discovered assets (NOT already in the static
 *     catalog) projected from the AssetRegistry overlay, for the review card.
 *   - `sync()` — re-runs discovery against the live wallet(s) and reports the counts.
 *
 * Neither moves money (§3.1): discovery reads the provider's asset listing and merges
 * metadata into the in-memory overlay. `sync` CAN bring new assets into the tradeable
 * overlay, so the endpoint is step-up-gated (in the controller) and the action is
 * immutably audited here. Holds no Prisma import — reaches audit via the injected
 * service and assets via the global AssetRegistry (§3.2).
 */
@Injectable()
export class AdminAssetsService {
  constructor(
    private readonly registry: AssetRegistry,
    private readonly catalogSync: CatalogSyncService,
    private readonly audit: AuditService,
  ) {}

  /** The newly-discovered assets (not yet in the static catalog) for the review card. */
  listDiscovered(): AdminDiscoveredAssetListResponse {
    const items = this.registry
      .listDiscoveredAssets()
      .filter((a) => !a.inStaticCatalog)
      .map(toWire);
    return { items };
  }

  /**
   * Re-run Blockradar discovery for all enabled networks (resilient — CatalogSyncService
   * swallows per-network failures) and report how many assets were seen and how many are
   * genuinely new. Audited (`admin_update`, subject `AssetCatalog:blockradar-sync`).
   */
  async sync(adminId: string): Promise<AdminAssetsSyncResponse> {
    await this.catalogSync.refresh();
    const all = this.registry.listDiscoveredAssets();
    const result: AdminAssetsSyncResponse = {
      discoveredCount: all.length,
      newCount: all.filter((a) => !a.inStaticCatalog).length,
    };
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: 'AssetCatalog:blockradar-sync',
      action: 'admin_update',
      after: result,
    });
    return result;
  }
}

/** Projects a registry discovery view into the wire `AdminDiscoveredAsset` shape (§8). */
function toWire(v: DiscoveredAssetView): AdminDiscoveredAsset {
  return {
    symbol: v.symbol,
    displayName: v.displayName,
    decimals: v.decimals,
    networks: v.networks,
    contractAddress: v.contractAddress,
    blockradarAssetId: v.blockradarAssetId,
    logoUrl: v.logoUrl,
    enabled: v.enabled,
    inStaticCatalog: v.inStaticCatalog,
  };
}
