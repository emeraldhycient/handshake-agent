import { AdminCurrencyService } from './admin-currency.service';
import { CurrencyCollisionError } from '../domain/currency-errors';
import { MultiCurrencyInvariantError } from '../domain/settings-errors';
import { AdminNotFoundError } from '../domain/admin-errors';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { CustomFiatSyncService } from './custom-fiat-sync.service';
import type {
  CreateCustomFiatInput,
  CustomFiatRecord,
  ICustomFiatRepository,
  UpdateCustomFiatInput,
} from './ports/custom-fiat.repository.port';

/**
 * AdminCurrencyService — the runtime "Add currency" CRUD. These tests pin the
 * funds-safety branches (root CLAUDE.md §3):
 *   - add: rejects a code that collides with a BUILT-IN catalog fiat or an existing
 *     custom fiat; otherwise creates the currency DISABLED, audits, then syncs.
 *   - update(enabled=true): fail-closed — rejected unless pricing exists (a base rate
 *     keyed by the code on at least one asset); accepted when pricing exists.
 *   - update(enabled=false / metadata): applied, audited, then synced.
 * Every write is audited (admin_update, subject Currency:<code>) and republishes the
 * overlay via the sync service.
 */
describe('AdminCurrencyService', () => {
  const ADMIN_ID = 'admin-1';

  const record = (over: Partial<CustomFiatRecord> = {}): CustomFiatRecord => ({
    code: 'EUR',
    displayName: 'Euro',
    symbol: '€',
    decimals: 2,
    enabled: false,
    createdAt: new Date('2026-07-03T00:00:00.000Z'),
    ...over,
  });

  function makeSut(opts: {
    /** Built-in catalog fiat codes (static registry). */
    builtinFiats?: string[];
    /** Existing custom fiats (by code). */
    existing?: CustomFiatRecord[];
    /** pricing.assets snapshot used for the base-rate check. */
    pricingAssets?: Record<string, { baseRates?: Record<string, number> }>;
  }) {
    const existing = opts.existing ?? [];

    const repo: jest.Mocked<ICustomFiatRepository> = {
      listAll: jest.fn().mockResolvedValue(existing),
      findByCode: jest
        .fn()
        .mockImplementation((code: string) =>
          Promise.resolve(existing.find((r) => r.code === code) ?? null),
        ),
      create: jest
        .fn()
        .mockImplementation((input: CreateCustomFiatInput) =>
          Promise.resolve(record({ ...input, enabled: false })),
        ),
      update: jest
        .fn()
        .mockImplementation((code: string, patch: UpdateCustomFiatInput) =>
          Promise.resolve(
            record({
              ...existing.find((r) => r.code === code),
              ...patch,
              code,
            }),
          ),
        ),
    };

    const registry = {
      // Built-in codes are "recognised" as static catalog fiats. supportedFiats
      // includes both built-ins and the custom overlay; the service uses a
      // built-in-only check, so we expose the static set separately.
      supportedFiats: jest
        .fn()
        .mockReturnValue(opts.builtinFiats ?? ['NGN', 'USD']),
    } as unknown as AssetRegistry;

    const effectiveConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'pricing') return { assets: opts.pricingAssets ?? {} };
        return undefined;
      }),
    } as unknown as EffectiveConfigService;

    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const sync = {
      sync: jest.fn().mockResolvedValue(undefined),
    } as unknown as CustomFiatSyncService;

    const service = new AdminCurrencyService(
      repo,
      registry,
      effectiveConfig,
      audit,
      sync,
    );
    return { service, repo, registry, effectiveConfig, audit, sync };
  }

  describe('list', () => {
    it('returns all custom fiats mapped to the wire shape', async () => {
      const { service } = makeSut({
        existing: [
          record({ code: 'EUR', enabled: true }),
          record({ code: 'GHS' }),
        ],
      });
      const res = await service.list();
      expect(res.items).toHaveLength(2);
      expect(res.items[0]).toEqual({
        code: 'EUR',
        displayName: 'Euro',
        symbol: '€',
        decimals: 2,
        enabled: true,
        createdAt: '2026-07-03T00:00:00.000Z',
      });
    });
  });

  describe('add', () => {
    const input = {
      code: 'EUR',
      displayName: 'Euro',
      symbol: '€',
      decimals: 2,
    };

    it('rejects a code that collides with a BUILT-IN catalog fiat', async () => {
      const { service, repo } = makeSut({ builtinFiats: ['NGN', 'EUR'] });
      await expect(service.add(input, ADMIN_ID)).rejects.toBeInstanceOf(
        CurrencyCollisionError,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a code that collides with an existing custom fiat', async () => {
      const { service, repo } = makeSut({
        builtinFiats: ['NGN'],
        existing: [record({ code: 'EUR' })],
      });
      await expect(service.add(input, ADMIN_ID)).rejects.toBeInstanceOf(
        CurrencyCollisionError,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates the currency DISABLED, audits (admin_update / Currency:<code>), then syncs', async () => {
      const { service, repo, audit, sync } = makeSut({ builtinFiats: ['NGN'] });

      const res = await service.add(input, ADMIN_ID);

      expect(repo.create).toHaveBeenCalledWith({
        code: 'EUR',
        displayName: 'Euro',
        symbol: '€',
        decimals: 2,
        addedByAdminId: ADMIN_ID,
      });
      expect(res.enabled).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: ADMIN_ID,
          subject: 'Currency:EUR',
          action: 'admin_update',
        }),
      );
      expect(sync.sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('rejects enabling a currency that has NO pricing (fail-closed)', async () => {
      const { service, repo, sync } = makeSut({
        existing: [record({ code: 'EUR', enabled: false })],
        pricingAssets: { USDT: { baseRates: { NGN: 1600 } } }, // no EUR rate
      });
      await expect(
        service.update('EUR', { enabled: true }, ADMIN_ID),
      ).rejects.toBeInstanceOf(MultiCurrencyInvariantError);
      expect(repo.update).not.toHaveBeenCalled();
      expect(sync.sync).not.toHaveBeenCalled();
    });

    it('enables a currency when a base rate is keyed by its code', async () => {
      const { service, repo, audit, sync } = makeSut({
        existing: [record({ code: 'EUR', enabled: false })],
        pricingAssets: { USDT: { baseRates: { EUR: 1.08 } } },
      });

      const res = await service.update('EUR', { enabled: true }, ADMIN_ID);

      expect(repo.update).toHaveBeenCalledWith('EUR', { enabled: true });
      expect(res.enabled).toBe(true);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Currency:EUR',
          action: 'admin_update',
        }),
      );
      expect(sync.sync).toHaveBeenCalledTimes(1);
    });

    it('disables a currency without any pricing check', async () => {
      const { service, repo, sync } = makeSut({
        existing: [record({ code: 'EUR', enabled: true })],
        pricingAssets: {}, // no pricing at all — disable must still succeed
      });

      const res = await service.update('EUR', { enabled: false }, ADMIN_ID);

      expect(repo.update).toHaveBeenCalledWith('EUR', { enabled: false });
      expect(res.enabled).toBe(false);
      expect(sync.sync).toHaveBeenCalledTimes(1);
    });

    it('applies a metadata-only patch (no enabled) without a pricing check', async () => {
      const { service, repo } = makeSut({
        existing: [record({ code: 'EUR' })],
        pricingAssets: {},
      });

      await service.update('EUR', { displayName: 'Euro (EU)' }, ADMIN_ID);

      expect(repo.update).toHaveBeenCalledWith('EUR', {
        displayName: 'Euro (EU)',
      });
    });

    it('fails closed (404) when the currency does not exist', async () => {
      const { service, repo } = makeSut({ existing: [] });
      await expect(
        service.update('EUR', { enabled: false }, ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
