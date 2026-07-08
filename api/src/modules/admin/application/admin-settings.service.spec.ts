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
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { ICustomFiatRepository } from './ports/custom-fiat.repository.port';

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

/**
 * CustomFiat store stand-in: `codes` are the runtime admin-added currencies the
 * dynamic-key resolution may accept (the store is the source of truth, not the
 * static KNOWN_FIAT_CURRENCIES enum).
 */
function makeCustomFiatStore(codes: string[] = []): ICustomFiatRepository {
  return {
    listAll: () => Promise.resolve([]),
    findByCode: (code: string) =>
      Promise.resolve(
        codes.includes(code)
          ? {
              code,
              displayName: code,
              symbol: code,
              decimals: 2,
              enabled: false,
              createdAt: new Date(0),
            }
          : null,
      ),
    create: () => Promise.reject(new Error('not used in this spec')),
    update: () => Promise.reject(new Error('not used in this spec')),
  };
}

/** AssetRegistry stand-in exposing only the provider-DISCOVERED symbol set. */
function makeRegistry(discovered: string[] = []): AssetRegistry {
  return {
    listDiscoveredAssets: () =>
      discovered.map((symbol) => ({
        symbol,
        displayName: symbol,
        decimals: 6,
        networks: ['TRON'],
        contractAddress: null,
        blockradarAssetId: null,
        logoUrl: null,
        enabled: true,
        inStaticCatalog: false,
      })),
  } as unknown as AssetRegistry;
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
      const svc = new AdminSettingsService(
        repo,
        effective,
        audit,
        publisher,
        makeCustomFiatStore(),
        makeRegistry(),
      );

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
      const svc = new AdminSettingsService(
        repo,
        effective,
        audit,
        publisher,
        makeCustomFiatStore(),
        makeRegistry(),
      );

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
      const svc = new AdminSettingsService(
        repo,
        effective,
        audit,
        publisher,
        makeCustomFiatStore(),
        makeRegistry(),
      );

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
      const svc = new AdminSettingsService(
        repo,
        effective,
        audit,
        publisher,
        makeCustomFiatStore(),
        makeRegistry(),
      );

      const got = await svc.get('pricing.processingFeeBps');
      expect(got.key).toBe('pricing.processingFeeBps');
      expect(got.value).toBe(100);
    });

    it('throws SettingValidationError for an unknown key', async () => {
      const { repo } = makeRepo();
      const { effective } = makeEffectiveConfig({});
      const { publisher } = makePublisher();
      const { audit } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        effective,
        audit,
        publisher,
        makeCustomFiatStore(),
        makeRegistry(),
      );

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
        makeCustomFiatStore(),
        makeRegistry(),
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
        makeCustomFiatStore(),
        makeRegistry(),
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
        makeCustomFiatStore(),
        makeRegistry(),
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
        makeCustomFiatStore(),
        makeRegistry(),
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
        makeCustomFiatStore(),
        makeRegistry(),
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
        makeCustomFiatStore(),
        makeRegistry(),
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

  // ── Dynamic per-currency keys for RUNTIME custom fiats (Wave D) ─────────────
  // A custom currency's code is by construction OUTSIDE KNOWN_FIAT_CURRENCIES
  // (AdminCurrencyService.add rejects collisions), so its pricing/limits keys are
  // not in the static SETTING_REGISTRY. The service must accept them by consulting
  // the CustomFiat store and validating with the SAME template validator the
  // registered per-currency keys use — never loosened.
  describe('update — dynamic custom-fiat keys', () => {
    function makeSvc(customCodes: string[]) {
      const { repo, state } = makeRepo();
      const ec = makeEffectiveConfig({}, state);
      const { publisher } = makePublisher();
      const { audit, calls } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
        makeCustomFiatStore(customCodes),
        makeRegistry(),
      );
      return { svc, state, calls, ec };
    }

    it('accepts a base-rate key for a store-backed custom fiat (priced → enableable)', async () => {
      const { svc, state, calls, ec } = makeSvc(['XOF']);

      const result = await svc.update(
        'pricing.assets.USDT.baseRates.XOF',
        580,
        'global',
        null,
        'admin-1',
      );

      expect(state.upserts).toHaveLength(1);
      expect(state.upserts[0].key).toBe('pricing.assets.USDT.baseRates.XOF');
      expect(state.upserts[0].value).toBe(580);
      // Audit + hot-reload behave exactly like a registered key.
      expect(ec.refreshes).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].subject).toBe(
        'AppSetting:pricing.assets.USDT.baseRates.XOF',
      );
      expect(result.key).toBe('pricing.assets.USDT.baseRates.XOF');
      expect(result.source).toBe('db');
    });

    it('accepts a tier-limit key for a store-backed custom fiat', async () => {
      const { svc, state } = makeSvc(['XOF']);
      await svc.update(
        'limits.XOF.tier_1.perTxFiatMax',
        30_000,
        'global',
        null,
        'admin-1',
      );
      expect(state.upserts).toHaveLength(1);
      expect(state.upserts[0].key).toBe('limits.XOF.tier_1.perTxFiatMax');
    });

    it('applies the SAME template validation to a dynamic key (negative rate rejected, no write)', async () => {
      const { svc, state } = makeSvc(['XOF']);
      await expect(
        svc.update(
          'pricing.assets.USDT.baseRates.XOF',
          -1,
          'global',
          null,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(SettingValidationError);
      expect(state.upserts).toHaveLength(0);
    });

    it('rejects a per-currency key whose code is NOT in the custom-fiat store (fail-closed)', async () => {
      const { svc, state } = makeSvc([]);
      await expect(
        svc.update(
          'pricing.assets.USDT.baseRates.XOF',
          580,
          'global',
          null,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(SettingValidationError);
      expect(state.upserts).toHaveLength(0);
    });

    it('never accepts a catalog live-flag for a custom fiat (liveness is owned by the currency console)', async () => {
      const { svc, state } = makeSvc(['XOF']);
      await expect(
        svc.update(
          'catalog.fiats.XOF.enabled',
          true,
          'global',
          null,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(SettingValidationError);
      expect(state.upserts).toHaveLength(0);
    });
  });

  // ── Dynamic kill-switch keys for provider-DISCOVERED assets (Wave D) ────────
  describe('update — discovered-asset enabled toggles', () => {
    function makeSvc(discovered: string[]) {
      const { repo, state } = makeRepo();
      const base = consistentCatalogValues();
      const ec = makeEffectiveConfig(
        {
          catalog: base.catalog,
          limits: base.limits,
          pricing: base.pricing,
        },
        state,
      );
      const { publisher } = makePublisher();
      const { audit, calls } = makeAudit();
      const svc = new AdminSettingsService(
        repo,
        ec.effective,
        audit,
        publisher,
        makeCustomFiatStore(),
        makeRegistry(discovered),
      );
      return { svc, state, calls };
    }

    it('persists catalog.assets.<sym>.enabled for a provider-discovered symbol (no 422)', async () => {
      const { svc, state, calls } = makeSvc(['USDC']);
      await svc.update(
        'catalog.assets.USDC.enabled',
        false,
        'global',
        null,
        'admin-1',
      );
      expect(state.upserts).toHaveLength(1);
      expect(state.upserts[0]).toMatchObject({
        key: 'catalog.assets.USDC.enabled',
        value: false,
      });
      expect(calls[0].subject).toBe('AppSetting:catalog.assets.USDC.enabled');
    });

    it('applies the boolean template validation (string value rejected, no write)', async () => {
      const { svc, state } = makeSvc(['USDC']);
      await expect(
        svc.update(
          'catalog.assets.USDC.enabled',
          'yes',
          'global',
          null,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(SettingValidationError);
      expect(state.upserts).toHaveLength(0);
    });

    it('rejects an enabled toggle for a symbol that was never discovered (fail-closed)', async () => {
      const { svc, state } = makeSvc([]);
      await expect(
        svc.update(
          'catalog.assets.USDC.enabled',
          false,
          'global',
          null,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(SettingValidationError);
      expect(state.upserts).toHaveLength(0);
    });
  });
});
