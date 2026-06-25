/**
 * PublicConfigModule — exposes GET /config backed by AssetRegistry (Task 15).
 *
 * AssetRegistry is provided by the global CatalogModule (registered in
 * AppModule). Because CatalogModule is @Global, there is no need to import
 * it here — Nest resolves AssetRegistry from the global DI container.
 *
 * ConfigModule (@nestjs/config's module) is also global (registered in
 * AppModule), so ConfigService is available to AssetRegistry automatically.
 *
 * No Prisma, no external adapters — the endpoint is DB-FREE.
 */

import { Module } from '@nestjs/common';

import { PublicConfigController } from './presentation/public-config.controller';

@Module({
  controllers: [PublicConfigController],
})
export class PublicConfigModule {}
