/**
 * PublicConfigController — exposes the non-secret asset/fiat/network catalog
 * and capability flags to the frontend (Task 15, CLAUDE.md §7).
 *
 * GET /config → PublicConfigResponse
 *
 * There is NO global route prefix, so the path is exactly `/config`.
 *
 * Security:
 *   - `AssetRegistry.publicView()` strips secrets (providers/assetId,
 *     masterWalletId, amlBlockchain, addressPattern, networkFeeCrypto)
 *     and filters to enabled entries only.
 *   - The result is additionally parsed through `PublicConfigResponseSchema`
 *     before returning: Zod `.parse()` strips unknown keys so future drift in
 *     `publicView()` cannot accidentally leak a new secret field.
 *
 * Architecture: presentation layer only. Depends on `AssetRegistry` from
 * the global `CatalogModule` — no Prisma, no DB, no external calls.
 * `dependency-cruiser` will not flag this: presentation → core/catalog is
 * a valid downward dependency.
 */

import { Controller, Get } from '@nestjs/common';

import { PublicConfigResponseSchema } from '@handshake-agent/contracts';
import type { PublicConfigResponse } from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';

@Controller('config')
export class PublicConfigController {
  constructor(private readonly assetRegistry: AssetRegistry) {}

  /**
   * GET /config
   *
   * Returns the enabled fiats, crypto assets, blockchain networks, and
   * capability flags. No secrets are included in the response.
   *
   * The frontend caches this via TanStack Query to drive show/hide of features
   * (CLAUDE.md §7 — "The frontend reads effective, non-secret flags from a
   * /config endpoint").
   */
  @Get()
  getPublicConfig(): PublicConfigResponse {
    const view = this.assetRegistry.publicView();
    // Parse through the contract schema: strips unknown keys + validates shape.
    // Acts as a final defense-in-depth gate so publicView() drift never leaks
    // a secret field to the wire.
    return PublicConfigResponseSchema.parse(view);
  }
}
