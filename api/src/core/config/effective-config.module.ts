import { Global, Module } from '@nestjs/common';

import { EffectiveConfigService } from './application/effective-config.service';
import { APP_SETTING_REPOSITORY } from './application/ports/app-setting.repository.port';
import { AppSettingPrismaRepository } from './infrastructure/app-setting.prisma.repository';
import {
  ConfigInvalidationPublisher,
  ConfigInvalidationSubscriber,
} from './infrastructure/config-invalidation';

// Global: the layered config (CLAUDE.md §7) is cross-cutting — any module's
// services read tunable values through EffectiveConfigService without re-importing.
@Global()
@Module({
  providers: [
    EffectiveConfigService,
    { provide: APP_SETTING_REPOSITORY, useClass: AppSettingPrismaRepository },
    ConfigInvalidationPublisher,
    ConfigInvalidationSubscriber,
  ],
  exports: [
    EffectiveConfigService,
    APP_SETTING_REPOSITORY,
    ConfigInvalidationPublisher,
  ],
})
export class EffectiveConfigModule {}
