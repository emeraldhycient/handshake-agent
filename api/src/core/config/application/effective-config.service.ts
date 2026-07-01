import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import configuration, { type AppConfig } from '../configuration';
import { applyOverrides, getAtPath } from '../domain/config-merge';
import {
  APP_SETTING_REPOSITORY,
  type IAppSettingRepository,
} from './ports/app-setting.repository.port';

/**
 * The layered config (CLAUDE.md §7): exposes the SAME `get<T>(key)` shape as
 * `ConfigService<AppConfig>` so consumers swap their injection without changing
 * call sites, but overlays editable DB `AppSetting` rows on top of the env/JSON
 * base. The merged snapshot is held in memory and read SYNCHRONOUSLY so money-path
 * math (spreads, limits, fees) stays fast; it is rebuilt on boot and whenever the
 * admin layer publishes a `config:invalidate`. Fail-safe: if the DB is unreadable
 * the snapshot stays on the env/JSON base (i.e. exactly today's behaviour).
 */
@Injectable()
export class EffectiveConfigService implements OnModuleInit {
  private readonly logger = new Logger(EffectiveConfigService.name);
  private snapshot: AppConfig = configuration();

  constructor(
    @Inject(APP_SETTING_REPOSITORY)
    private readonly repo: IAppSettingRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refresh();
    } catch (err) {
      // Boot resilience: keep the env/JSON base if the override layer is
      // unavailable — never block startup or silently drop to empty config.
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'EffectiveConfig: failed to load AppSetting overrides at boot — using env/JSON base',
      );
    }
  }

  /** Rebuild the merged snapshot from the current editable AppSetting rows. */
  async refresh(): Promise<void> {
    const base = configuration();
    const rows = await this.repo.findAllEditable();
    const globalOverrides = rows
      .filter((r) => r.scope === 'global')
      .map((r) => ({ key: r.key, value: r.value }));
    this.snapshot = applyOverrides(base, globalOverrides);
  }

  /** Resolve a section key ('pricing') or a dot-path ('limits.NGN.tier_1.perTxFiatMax'). */
  get<T>(key: string): T {
    return getAtPath(this.snapshot, key) as T;
  }
}
