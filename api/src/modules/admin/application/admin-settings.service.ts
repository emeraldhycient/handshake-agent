import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { z } from 'zod';

import {
  SETTING_REGISTRY,
  type EffectiveSetting,
  type SettingRegistryEntry,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import {
  APP_SETTING_REPOSITORY,
  type AppSettingScope,
  type IAppSettingRepository,
} from '../../../core/config/application/ports/app-setting.repository.port';
import { setAtPath } from '../../../core/config/domain/config-merge';
import { ConfigInvalidationPublisher } from '../../../core/config/infrastructure/config-invalidation';
import {
  MultiCurrencyInvariantError,
  SettingNotEditableError,
  SettingValidationError,
} from '../domain/settings-errors';

// Sections consulted by the multi-currency invariant — assembled into a candidate
// snapshot so a proposed catalog override can be validated BEFORE it is written.
interface CatalogSnapshot {
  fiats?: Record<string, { enabled?: boolean }>;
}
interface FiatLimitsSnapshot {
  [code: string]: unknown;
}
interface PricingSnapshot {
  assets?: Record<string, { baseRates?: Record<string, number> }>;
}
interface CandidateConfig {
  catalog: CatalogSnapshot;
  limits: FiatLimitsSnapshot;
  pricing: PricingSnapshot;
}

/**
 * Build the runtime validator for a registry entry from its valueType + bounds.
 * Entry-based (not key-based like contracts' settingSchemaFor) so the resolved
 * entry — not a second registry lookup — drives validation.
 */
function schemaForEntry(entry: SettingRegistryEntry): z.ZodTypeAny {
  switch (entry.valueType) {
    case 'number': {
      let schema = z.number();
      if (entry.min !== undefined) schema = schema.min(entry.min);
      if (entry.max !== undefined) schema = schema.max(entry.max);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'string':
      return entry.options && entry.options.length > 0
        ? z.enum(entry.options as [string, ...string[]])
        : z.string();
    case 'string[]':
      return z.array(z.string());
  }
}

/**
 * The admin layered-config (AppSetting) console service (Phase 1, root CLAUDE.md
 * §7, DB-admin › env › JSON). It exposes the SETTING_REGISTRY as effective
 * settings (metadata + current value + provenance) and applies validated overrides:
 * parse against the registered value schema, enforce the multi-currency invariant
 * for catalog changes, persist, hot-reload the in-process snapshot, broadcast a
 * cross-instance invalidation, and record an audited `config_change`.
 *
 * It never moves money and holds no Prisma import — it reaches the DB only through
 * the injected AppSetting port (root CLAUDE.md §3.2).
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(APP_SETTING_REPOSITORY)
    private readonly repo: IAppSettingRepository,
    private readonly effectiveConfig: EffectiveConfigService,
    private readonly audit: AuditService,
    private readonly publisher: ConfigInvalidationPublisher,
  ) {}

  /** Effective view of every non-secret registry entry (optionally one category). */
  async listEffective(category?: string): Promise<EffectiveSetting[]> {
    const rows = await this.repo.findAll();
    const overriddenKeys = new Set(rows.map((r) => r.key));
    return SETTING_REGISTRY.filter(
      (e) => !e.secret && (category === undefined || e.category === category),
    ).map((e) => this.toEffective(e, overriddenKeys.has(e.key)));
  }

  /** Effective view of a single registry entry; throws on an unknown key. */
  async get(key: string): Promise<EffectiveSetting> {
    const entry = this.findEntry(key);
    if (!entry) throw new SettingValidationError(`Unknown config key: ${key}`);
    const rows = await this.repo.findAll();
    return this.toEffective(
      entry,
      rows.some((r) => r.key === key),
    );
  }

  /**
   * Apply an admin override to a config key. Validates against the registry, the
   * value schema, and (for catalog changes) the multi-currency invariant; then
   * persists, refreshes the in-process snapshot, publishes the cross-instance
   * invalidation, and audits a `config_change`.
   */
  async update(
    key: string,
    value: unknown,
    scope: AppSettingScope,
    scopeValue: string | null,
    adminId: string,
  ): Promise<EffectiveSetting> {
    const entry = this.findEntry(key);
    if (!entry) throw new SettingValidationError(`Unknown config key: ${key}`);
    if (!entry.editable) throw new SettingNotEditableError(key);

    const parsed = this.parseValue(entry, value);
    if (key.startsWith('catalog.'))
      this.assertMultiCurrencyInvariant(key, parsed);

    const before = this.effectiveConfig.get<unknown>(key);
    await this.repo.upsert({
      key,
      value: parsed,
      scope,
      scopeValue,
      isSecret: entry.secret,
      isEditable: entry.editable,
      updatedByAdminId: adminId,
    });

    // In-process hot-reload first, then notify other instances; finally audit.
    await this.effectiveConfig.refresh();
    await this.publisher.publish();
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `AppSetting:${key}`,
      action: 'config_change',
      before,
      after: parsed,
    });

    return this.toEffective(entry, true);
  }

  /** Registry-by-key resolver — a single seam, so tests can override editability. */
  private findEntry(key: string): SettingRegistryEntry | undefined {
    return SETTING_REGISTRY.find((e) => e.key === key);
  }

  private parseValue(entry: SettingRegistryEntry, value: unknown): unknown {
    try {
      return schemaForEntry(entry).parse(value);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new SettingValidationError(
        `Invalid value for "${entry.key}": ${detail}`,
      );
    }
  }

  private toEffective(
    entry: SettingRegistryEntry,
    hasOverride: boolean,
  ): EffectiveSetting {
    return {
      key: entry.key,
      category: entry.category,
      label: entry.label,
      description: entry.description,
      valueType: entry.valueType,
      editable: entry.editable,
      value: this.effectiveConfig.get<unknown>(entry.key),
      source: hasOverride ? 'db' : 'default',
      scope: entry.scope,
      scopeValue: null,
    };
  }

  /**
   * Multi-currency invariant: every ENABLED fiat must remain transactable —
   * it must have a tier-limit set AND a base rate on at least one priced asset.
   * Recomputes a candidate config (base catalog/limits/pricing + this override
   * applied in-memory) and asserts it, so a breaking catalog change is rejected
   * before it ever reaches the override layer.
   */
  private assertMultiCurrencyInvariant(key: string, value: unknown): void {
    const candidate = setAtPath<CandidateConfig>(
      {
        catalog: this.effectiveConfig.get<CatalogSnapshot>('catalog'),
        limits: this.effectiveConfig.get<FiatLimitsSnapshot>('limits'),
        pricing: this.effectiveConfig.get<PricingSnapshot>('pricing'),
      },
      key,
      value,
    );

    const fiats = candidate.catalog.fiats ?? {};
    const limits = candidate.limits ?? {};
    const assets = candidate.pricing.assets ?? {};

    for (const [code, fiat] of Object.entries(fiats)) {
      if (fiat?.enabled !== true) continue;
      const hasLimits = limits[code] !== undefined;
      const hasRate = Object.values(assets).some(
        (a) => a?.baseRates?.[code] !== undefined,
      );
      if (!hasLimits || !hasRate) {
        throw new MultiCurrencyInvariantError(
          `Enabled fiat "${code}" must have tier limits and a base rate.`,
        );
      }
    }
  }
}
