/**
 * CatalogModule — provides AssetRegistry globally so any feature module can
 * inject it without re-importing this module (CLAUDE.md §7 service registry).
 *
 * ConfigModule is already global; CatalogModule marks itself @Global so
 * AssetRegistry is available across the DI container without explicit imports.
 */

import { Global, Module } from '@nestjs/common';

import { AssetRegistry } from './asset-registry';

@Global()
@Module({
  providers: [AssetRegistry],
  exports: [AssetRegistry],
})
export class CatalogModule {}
