import configuration from '../configuration';
import type { PricingConfig } from '../configuration';
import { EffectiveConfigService } from './effective-config.service';
import type {
  AppSettingRow,
  IAppSettingRepository,
} from './ports/app-setting.repository.port';

function repoWith(rows: AppSettingRow[]): IAppSettingRepository {
  return {
    findAllEditable: () => Promise.resolve(rows),
    findAll: () => Promise.resolve(rows),
    findByKey: () => Promise.resolve(null),
    upsert: () => Promise.reject(new Error('nyi')),
  };
}

function row(key: string, value: unknown): AppSettingRow {
  return {
    key,
    value,
    scope: 'global',
    scopeValue: null,
    isSecret: false,
    isEditable: true,
  };
}

describe('EffectiveConfigService', () => {
  it('with NO overrides, reads are identical to the env/JSON base (money-path safe)', async () => {
    const svc = new EffectiveConfigService(repoWith([]));
    await svc.refresh();
    const base = configuration();
    expect(svc.get<PricingConfig>('pricing')).toEqual(base.pricing);
    expect(svc.get<number>('pricing.processingFeeBps')).toBe(
      base.pricing.processingFeeBps,
    );
    expect(svc.get<number>('limits.NGN.tier_1.perTxFiatMax')).toBe(
      base.limits.NGN.tier_1.perTxFiatMax,
    );
  });

  it('applies a global DB override over the base', async () => {
    const svc = new EffectiveConfigService(
      repoWith([row('pricing.processingFeeBps', 250)]),
    );
    await svc.refresh();
    expect(svc.get<number>('pricing.processingFeeBps')).toBe(250);
    // and the section getter reflects the override too
    expect(svc.get<PricingConfig>('pricing').processingFeeBps).toBe(250);
    // sibling base values are untouched
    const base = configuration();
    expect(svc.get<number>('pricing.expiresInSec')).toBe(
      base.pricing.expiresInSec,
    );
  });

  it('overrides a nested per-asset spread without disturbing other assets', async () => {
    const svc = new EffectiveConfigService(
      repoWith([row('pricing.assets.USDT.buySpreadBps', 175)]),
    );
    await svc.refresh();
    expect(svc.get<number>('pricing.assets.USDT.buySpreadBps')).toBe(175);
    const base = configuration();
    expect(svc.get<number>('pricing.assets.BTC.buySpreadBps')).toBe(
      base.pricing.assets.BTC.buySpreadBps,
    );
  });

  it('refresh() picks up newly added overrides', async () => {
    const rows: AppSettingRow[] = [];
    const svc = new EffectiveConfigService(repoWith(rows));
    await svc.refresh();
    const base = configuration();
    expect(svc.get<number>('pricing.processingFeeBps')).toBe(
      base.pricing.processingFeeBps,
    );
    rows.push(row('pricing.processingFeeBps', 999));
    await svc.refresh();
    expect(svc.get<number>('pricing.processingFeeBps')).toBe(999);
  });

  it('ignores non-global-scope rows (handled by a later phase)', async () => {
    const tierRow: AppSettingRow = {
      key: 'pricing.processingFeeBps',
      value: 777,
      scope: 'tier',
      scopeValue: 'tier_1',
      isSecret: false,
      isEditable: true,
    };
    const svc = new EffectiveConfigService(repoWith([tierRow]));
    await svc.refresh();
    const base = configuration();
    expect(svc.get<number>('pricing.processingFeeBps')).toBe(
      base.pricing.processingFeeBps,
    );
  });
});
