import configuration from './configuration';

describe('configuration — statement', () => {
  it('exposes statement defaults', () => {
    const cfg = configuration();
    expect(cfg.statement).toEqual({
      linkTtlSeconds: 900,
      maxWindowDays: 365,
      rowCap: 100,
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
