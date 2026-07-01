import configuration, { validateConfig } from './configuration';
import type { AppConfig } from './configuration';

describe('configuration — statement', () => {
  it('exposes statement defaults', () => {
    const cfg = configuration();
    expect(cfg.statement).toEqual({
      linkTtlSeconds: 900,
      maxWindowDays: 400,
      defaultPageSize: 10,
      maxPageSize: 100,
      statementMaxRows: 5000,
      timezoneOffsetMinutes: 60,
    });
  });
});

describe('configuration — catalog fiats (multi-currency foundation)', () => {
  it('NGN is enabled (the only live currency)', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['NGN']).toBeDefined();
    expect(cfg.catalog.fiats['NGN'].enabled).toBe(true);
  });

  it('GHS is present but not enabled', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['GHS']).toBeDefined();
    expect(cfg.catalog.fiats['GHS'].enabled).toBe(false);
  });

  it('KES is present but not enabled', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['KES']).toBeDefined();
    expect(cfg.catalog.fiats['KES'].enabled).toBe(false);
  });

  it('UGX is present but not enabled', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['UGX']).toBeDefined();
    expect(cfg.catalog.fiats['UGX'].enabled).toBe(false);
  });

  it('TZS is present but not enabled', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['TZS']).toBeDefined();
    expect(cfg.catalog.fiats['TZS'].enabled).toBe(false);
  });

  it('RWF is present but not enabled', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['RWF']).toBeDefined();
    expect(cfg.catalog.fiats['RWF'].enabled).toBe(false);
  });

  it('ZAR is present but not enabled', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['ZAR']).toBeDefined();
    expect(cfg.catalog.fiats['ZAR'].enabled).toBe(false);
  });

  it('USD is present but not enabled', () => {
    const cfg = configuration();
    expect(cfg.catalog.fiats['USD']).toBeDefined();
    expect(cfg.catalog.fiats['USD'].enabled).toBe(false);
  });

  it('has exactly NGN + 7 non-live fiats = 8 total', () => {
    const cfg = configuration();
    expect(Object.keys(cfg.catalog.fiats)).toHaveLength(8);
  });

  it('each fiat entry has required shape fields', () => {
    const cfg = configuration();
    for (const [code, fiat] of Object.entries(cfg.catalog.fiats)) {
      expect(fiat.code).toBe(code);
      expect(typeof fiat.displayName).toBe('string');
      expect(typeof fiat.symbol).toBe('string');
      expect(typeof fiat.decimals).toBe('number');
      expect(typeof fiat.enabled).toBe('boolean');
    }
  });
});

describe('configuration — compliance.travelRuleThresholds (multi-currency)', () => {
  it('NGN threshold is 1,000,000', () => {
    const cfg = configuration();
    expect(cfg.compliance.travelRuleThresholds['NGN']).toBe(1_000_000);
  });

  it('USD threshold is 1,000', () => {
    const cfg = configuration();
    expect(cfg.compliance.travelRuleThresholds['USD']).toBe(1_000);
  });

  it('has a threshold for every fiat in the catalog', () => {
    const cfg = configuration();
    const fiatCodes = Object.keys(cfg.catalog.fiats);
    for (const code of fiatCodes) {
      expect(cfg.compliance.travelRuleThresholds[code]).toBeDefined();
      expect(cfg.compliance.travelRuleThresholds[code]).toBeGreaterThan(0);
    }
  });
});

describe('configuration — boot-time enabled-fiat cross-validation (#25)', () => {
  it('the committed defaults pass validation (only NGN is live, fully configured)', () => {
    // configuration() runs validateConfig() internally; if it throws, boot fails.
    expect(() => configuration()).not.toThrow();
  });

  it('validateConfig is a no-op for the committed defaults', () => {
    const cfg = configuration();
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('throws when an enabled fiat has NO limits block', () => {
    const cfg = configuration();
    // Enable GHS in the catalog but leave limits/baseRates absent → misconfig.
    cfg.catalog.fiats['GHS'].enabled = true;
    expect(() => validateConfig(cfg)).toThrow(/GHS/);
    expect(() => validateConfig(cfg)).toThrow(/limits/i);
  });

  it('throws when an enabled fiat has limits but NO pricing baseRate for an enabled tradeable asset', () => {
    const cfg = configuration();
    cfg.catalog.fiats['GHS'].enabled = true;
    // Give GHS a limits block so the limits check passes, but no baseRate.
    cfg.limits['GHS'] = {
      tier_1: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
    };
    expect(() => validateConfig(cfg)).toThrow(/GHS/);
    expect(() => validateConfig(cfg)).toThrow(/USDT/);
    expect(() => validateConfig(cfg)).toThrow(/baseRate|pricing/i);
  });

  it('passes when an enabled fiat has both limits and baseRates for every enabled tradeable asset', () => {
    const cfg = configuration();
    cfg.catalog.fiats['GHS'].enabled = true;
    cfg.limits['GHS'] = {
      tier_1: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
    };
    for (const [, asset] of Object.entries(cfg.pricing.assets)) {
      asset.baseRates['GHS'] = 1;
    }
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('ignores a NON-fiat-tradeable asset when checking baseRates (e.g. valuation-only assets)', () => {
    const cfg = configuration();
    cfg.catalog.fiats['GHS'].enabled = true;
    cfg.limits['GHS'] = {
      tier_1: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
    };
    // Mark every pricing asset as non-fiat-tradeable → no baseRate required.
    for (const [, asset] of Object.entries(cfg.pricing.assets)) {
      asset.fiatTradeable = false;
    }
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('does not require config for a fiat that is present but NOT enabled', () => {
    const cfg = configuration();
    // GHS stays enabled:false and has no limits/baseRates → must NOT throw.
    expect(cfg.catalog.fiats['GHS'].enabled).toBe(false);
    expect(cfg.limits['GHS']).toBeUndefined();
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('only requires baseRates for ENABLED assets (a disabled enabled-asset is skipped)', () => {
    const cfg: AppConfig = configuration();
    cfg.catalog.fiats['GHS'].enabled = true;
    cfg.limits['GHS'] = {
      tier_1: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
    };
    // Disable the catalog asset that has a pricing entry; its missing GHS baseRate
    // must then be ignored (the asset can't be traded anyway).
    for (const sym of Object.keys(cfg.catalog.assets)) {
      cfg.catalog.assets[sym].enabled = false;
    }
    expect(() => validateConfig(cfg)).not.toThrow();
  });
});
