import { SETTING_REGISTRY } from '@handshake-agent/contracts';

import { AdminSettingsService } from './admin-settings.service';
import {
  MultiCurrencyInvariantError,
  SettingNotEditableError,
  SettingValidationError,
} from '../domain/settings-errors';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  AppSettingRow,
  IAppSettingRepository,
  UpsertAppSettingInput,
} from '../../../core/config/application/ports/app-setting.repository.port';
import type { ConfigInvalidationPublisher } from '../../../core/config/infrastructure/config-invalidation';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';

// ── Test doubles ─────────────────────────────────────────────────────────────

interface RepoState {
  rows: AppSettingRow[];
  upserts: UpsertAppSettingInput[];
}

function makeRepo(rows: AppSettingRow[] = []): {
  repo: IAppSettingRepository;
  state: RepoState;
} {
  const state: RepoState = { rows, upserts: [] };
  const repo: IAppSettingRepository = {
    findAllEditable: () =>
      Promise.resolve(state.rows.filter((r) => r.isEditable)),
    findAll: () => Promise.resolve(state.rows),
    findByKey: (key, scope, scopeValue) =>
      Promise.resolve(
        state.rows.find(
          (r) =>
            r.key === key && r.scope === scope && r.scopeValue === scopeValue,
        ) ?? null,
      ),
    upsert(input): Promise<AppSettingRow> {
      state.upserts.push(input);
      const row: AppSettingRow = {
        key: input.key,
        value: input.value,
        scope: input.scope,
        scopeValue: input.scopeValue,
        isSecret: input.isSecret,
        isEditable: input.isEditable,
      };
      return Promise.resolve(row);
    },
  };
  return { repo, state };
}

/**
 * EffectiveConfigService stand-in driven by an in-memory snapshot map. `refresh`
 * overlays the linked repo's upserts (mirroring the real rebuild-from-DB) so a
 * post-update read returns the freshly-applied value.
 */
function makeEffectiveConfig(
  values: Record<string, unknown>,
  repoState?: RepoState,
): {
  effective: EffectiveConfigService;
  refreshes: number;
} {
  const counter = { n: 0 };
  const effective = {
    get<T>(key: string): T {
      return values[key] as T;
    },
    refresh(): Promise<void> {
      counter.n += 1;
      for (const u of repoState?.upserts ?? []) values[u.key] = u.value;
      return Promise.resolve();
    },
  } as unknown as EffectiveConfigService;
  return {
    effective,
    get refreshes() {
      return counter.n;
    },
  };
}

function makePublisher(): {
  publisher: ConfigInvalidationPublisher;
  publishes: { n: number };
} {
  const publishes = { n: 0 };
  const publisher = {
    publish(): Promise<void> {
      publishes.n += 1;
      return Promise.resolve();
    },
  } as unknown as ConfigInvalidationPublisher;
  return { publisher, publishes };
}

function makeAudit(): { audit: AuditService; calls: RecordAuditInput[] } {
  const calls: RecordAuditInput[] = [];
  const audit = {
    record(input: RecordAuditInput): Promise<void> {
      calls.push(input);
      return Promise.resolve();
    },
  } as unknown as AuditService;
  return { audit, calls };
}

function row(
  overrides: Partial<AppSettingRow> & { key: string },
): AppSettingRow {
  return {
    value: overrides.value ?? null,
    scope: overrides.scope ?? 'global',
    scopeValue: overrides.scopeValue ?? null,
    isSecret: overrides.isSecret ?? false,
    isEditable: overrides.isEditable ?? true,
    ...overrides,
  };
}

/** A minimal, valid multi-currency-consistent base (NGN enabled, has limits + rate). */
function consistentCatalogValues(): Record<string, unknown> {
  return {
    catalog: {
      fiats: { NGN: { code: 'NGN', enabled: true } },
      capabilities: {},
    },
    limits: {
      NGN: {
        tier_1: {
          perTxFiatMax: 50_000,
          dailyFiatMax: 200_000,
          dailyTxCountMax: 10,
        },
      },
    },
    pricing: {
      assets: { USDT: { baseRates: { NGN: 1600 } } },
    },
  };
}

describe('AdminSettingsService', () => {
  describe('listEffective', () => {
    it('maps the registry, reads each effective value, and reports source from findAll', async () => {
      const { repo } = makeRepo([
        row({ key: 'pricing.processingFeeBps', value: 120 }),
      ]);
      const { effective } = makeEffectiveConfig({
        'pricing.processingFeeBps': 120,
      });
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(repo, effective, audit, publisher);

      const list = await svc.listEffective();

      expect(list.length).toBe(SETTING_REGISTRY.length);
      const fee = list.find((s) => s.key === 'pricing.processingFeeBps')!;
      expect(fee.value).toBe(120);
      expect(fee.source).toBe('db');
      expect(fee.category).toBe('Pricing');
      // A key with no AppSetting row reports the env/JSON default as its source.
      const other = list.find((s) => s.key === 'pricing.expiresInSec')!;
      expect(other.source).toBe('default');
    });

    it('omits secret registry entries from the list', async () => {
      // No registry entry is secret today, so emulate one by spying the registry
      // filter via a key that IS secret would be omitted — assert none are secret.
      const { repo } = makeRepo();
      const { effective } = makeEffectiveConfig({});
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(repo, effective, audit, publisher);

      const list = await svc.listEffective();
      const secretKeys = SETTING_REGISTRY.filter((e) => e.secret).map(
        (e) => e.key,
      );
      for (const key of secretKeys) {
        expect(list.find((s) => s.key === key)).toBeUndefined();
      }
      // And the count never exceeds the non-secret registry size.
      expect(list.length).toBe(
        SETTING_REGISTRY.filter((e) => !e.secret).length,
      );
    });

    it('filters by category when given one', async () => {
      const { repo } = makeRepo();
      const { effective } = makeEffectiveConfig({});
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(repo, effective, audit, publisher);

      const list = await svc.listEffective('Pricing');
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((s) => s.category === 'Pricing')).toBe(true);
    });
  });

  describe('get', () => {
    it('returns a single effective setting for a known key', async () => {
      const { repo } = makeRepo();
      const { effective } = makeEffectiveConfig({
        'pricing.processingFeeBps': 100,
      });
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(repo, effective, audit, publisher);

      const got = await svc.get('pricing.processingFeeBps');
      expect(got.key).toBe('pricing.processingFeeBps');
      expect(got.value).toBe(100);
    });

    it('throws SettingValidationError for an unknown key', async () => {
      const { repo } = makeRepo();
      const { effective } = makeEffectiveConfig({});
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(repo, effective, audit, publisher);

      await expect(svc.get('not.a.real.key')).rejects.toBeInstanceOf(
        SettingValidationError,
      );
    });
  });

  describe('update', () => {
    it('updates an editable key: upserts, refreshes, publishes, audits config_change', async () => {
      const { repo, state } = makeRepo([
        row({ key: 'pricing.processingFeeBps', value: 100 }),
      ]);
      const ec = makeEffectiveConfig(
        { 'pricing.processingFeeBps': 100 },
        state,
      );
      const { publisher, publishes } = makePublisher();
      const { audit, calls } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
      );

      const result = await svc.update(
        'pricing.processingFeeBps',
        150,
        'global',
        null,
        'admin-1',
      );

      expect(state.upserts).toHaveLength(1);
      expect(state.upserts[0]).toEqual({
        key: 'pricing.processingFeeBps',
        value: 150,
        scope: 'global',
        scopeValue: null,
        isSecret: false,
        isEditable: true,
        updatedByAdminId: 'admin-1',
      });
      expect(ec.refreshes).toBe(1);
      expect(publishes.n).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('config_change');
      expect(calls[0].subject).toBe('AppSetting:pricing.processingFeeBps');
      expect(calls[0].actorAdminId).toBe('admin-1');
      expect(calls[0].before).toBe(100);
      expect(calls[0].after).toBe(150);
      expect(result.value).toBe(150);
      expect(result.source).toBe('db');
    });

    it('throws SettingValidationError for an unknown key (no write)', async () => {
      const { repo, state } = makeRepo();
      const ec = makeEffectiveConfig({});
      const { publisher } = makePublisher();
      const { audit, calls } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
      );

      await expect(
        svc.update('not.a.real.key', 1, 'global', null, 'admin-1'),
      ).rejects.toBeInstanceOf(SettingValidationError);
      expect(state.upserts).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it('throws SettingValidationError for an out-of-range value (no write)', async () => {
      const { repo, state } = makeRepo();
      const ec = makeEffectiveConfig({ 'pricing.processingFeeBps': 100 });
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
      );

      // processingFeeBps is bounded 0..10000; 99999 is out of range.
      await expect(
        svc.update(
          'pricing.processingFeeBps',
          99_999,
          'global',
          null,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(SettingValidationError);
      expect(state.upserts).toHaveLength(0);
      expect(ec.refreshes).toBe(0);
    });

    it('throws SettingNotEditableError for a non-editable registry key (no write)', async () => {
      // No registry entry is non-editable today, so inject a synthetic one in
      // front of the live registry via a spy on Array.prototype.find is brittle;
      // instead the service resolves the entry through a single seam we override
      // here: spy on the registry-by-key resolver to return a non-editable entry.
      const { repo, state } = makeRepo();
      const ec = makeEffectiveConfig({});
      const { publisher } = makePublisher();
      const { audit, calls } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
      );

      const findEntry = jest
        .spyOn(
          svc as unknown as { findEntry: (key: string) => unknown },
          'findEntry',
        )
        .mockReturnValue({
          key: 'frozen.key',
          scope: 'global',
          category: 'Config',
          editable: false,
          secret: false,
          valueType: 'number',
          label: 'Frozen',
          description: 'A non-editable entry.',
        });

      await expect(
        svc.update('frozen.key', 1, 'global', null, 'admin-1'),
      ).rejects.toBeInstanceOf(SettingNotEditableError);
      expect(state.upserts).toHaveLength(0);
      expect(calls).toHaveLength(0);

      findEntry.mockRestore();
    });

    it('enforces the multi-currency invariant: a catalog change leaving an enabled fiat without limits throws', async () => {
      // Base: NGN enabled, has limits + rate. The override flips a SECOND fiat on
      // (USD) which has NO limits / no base rate → invariant violation.
      // `catalog.fiats.*.enabled` is not a SETTING_REGISTRY key today, so resolve
      // it through the findEntry seam as a synthetic editable boolean catalog key.
      const base = consistentCatalogValues();
      const { repo, state } = makeRepo();
      const ec = makeEffectiveConfig({
        catalog: base.catalog,
        limits: base.limits,
        pricing: base.pricing,
      });
      const { publisher } = makePublisher();
      const { audit, calls } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
      );
      jest
        .spyOn(
          svc as unknown as { findEntry: (key: string) => unknown },
          'findEntry',
        )
        .mockReturnValue({
          key: 'catalog.fiats.USD.enabled',
          scope: 'global',
          category: 'Catalog',
          editable: true,
          secret: false,
          valueType: 'boolean',
          label: 'USD enabled',
          description: 'Enable USD as a transactable fiat.',
        });

      await expect(
        svc.update(
          'catalog.fiats.USD.enabled',
          true,
          'global',
          null,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(MultiCurrencyInvariantError);
      expect(state.upserts).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it('allows a catalog change that keeps every enabled fiat transactable', async () => {
      const base = consistentCatalogValues();
      const { repo, state } = makeRepo();
      const ec = makeEffectiveConfig({
        catalog: base.catalog,
        limits: base.limits,
        pricing: base.pricing,
        'catalog.capabilities.crypto.buy': true,
      });
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
      );

      // Toggling a capability flag doesn't disturb the NGN limits/rate invariant.
      await svc.update(
        'catalog.capabilities.crypto.buy',
        false,
        'global',
        null,
        'admin-1',
      );
      expect(state.upserts).toHaveLength(1);
    });
  });
});
