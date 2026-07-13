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

describe('configuration — treasury float targets (per-currency)', () => {
  it('exposes a per-currency fiatFloatTargets map keyed by every catalog fiat', () => {
    const cfg = configuration();
    const fiatCodes = Object.keys(cfg.catalog.fiats);
    for (const code of fiatCodes) {
      expect(cfg.treasury.fiatFloatTargets[code]).toBeDefined();
      expect(typeof cfg.treasury.fiatFloatTargets[code]).toBe('number');
      expect(cfg.treasury.fiatFloatTargets[code]).toBeGreaterThanOrEqual(0);
    }
  });

  it('ships every currency opt-in (0 target) by default — NGN behaviour unchanged', () => {
    const cfg = configuration();
    expect(cfg.treasury.fiatFloatTargets['NGN']).toBe(0);
    expect(cfg.treasury.fiatFloatTargets['USD']).toBe(0);
  });

  it('exposes a low-float threshold in bps (matches the in-service default)', () => {
    const cfg = configuration();
    expect(cfg.treasury.lowFloatThresholdBps).toBe(2500);
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

  it('passes: the shipped feed staleness window out-lives the quote window', () => {
    const cfg = configuration();
    // Sanity: the committed defaults satisfy the invariant (900 > 300).
    expect(cfg.pricing.feed?.stalenessSec).toBeGreaterThan(
      cfg.pricing.expiresInSec,
    );
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('throws when the feed staleness window is NOT longer than the quote window', () => {
    const cfg = configuration();
    // A live rate that goes stale WITHIN a quote's validity window would flip the
    // money path live↔config mid-window — fail-closed at boot.
    cfg.pricing.expiresInSec = 900;
    cfg.pricing.feed!.stalenessSec = 900; // equal → not strictly greater → invalid
    expect(() => validateConfig(cfg)).toThrow(/stalenessSec/);
    expect(() => validateConfig(cfg)).toThrow(/expiresInSec/);
  });

  it('throws when staleness is shorter than the quote window', () => {
    const cfg = configuration();
    cfg.pricing.expiresInSec = 600;
    cfg.pricing.feed!.stalenessSec = 300;
    expect(() => validateConfig(cfg)).toThrow(/stalenessSec/);
  });

  it('skips the feed/quote guard when no feed section is configured', () => {
    const cfg = configuration();
    delete cfg.pricing.feed;
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

describe('configuration — sumsub (Task 3.2)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // jest resetModules is NOT used here — configuration() re-reads process.env
    // on every call (it is a plain function, not memoized), mirroring the
    // existing agent.modelId / catalog.networks.TRON.masterWalletId pattern.
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults mockMode to true and baseUrl to the real Sumsub API host when env is unset', () => {
    delete process.env['KYC_MOCK_MODE'];
    delete process.env['SUMSUB_BASE_URL'];
    delete process.env['SUMSUB_LEVEL_TIER2'];
    delete process.env['SUMSUB_LEVEL_TIER3'];

    const cfg = configuration();

    expect(cfg.sumsub.mockMode).toBe(true);
    expect(cfg.sumsub.baseUrl).toBe('https://api.sumsub.com');
  });

  it('sets mockMode to false only when KYC_MOCK_MODE=false', () => {
    process.env['KYC_MOCK_MODE'] = 'false';

    const cfg = configuration();

    expect(cfg.sumsub.mockMode).toBe(false);
  });

  it('reads SUMSUB_BASE_URL from env when set', () => {
    process.env['SUMSUB_BASE_URL'] = 'https://test-api.sumsub.com';

    const cfg = configuration();

    expect(cfg.sumsub.baseUrl).toBe('https://test-api.sumsub.com');
  });

  it('builds levelToTier from SUMSUB_LEVEL_TIER2 / SUMSUB_LEVEL_TIER3 when both are set', () => {
    process.env['SUMSUB_LEVEL_TIER2'] = 'basic-kyc-level';
    process.env['SUMSUB_LEVEL_TIER3'] = 'enhanced-kyc-level';

    const cfg = configuration();

    expect(cfg.sumsub.levelToTier).toEqual({
      'basic-kyc-level': 'tier_2',
      'enhanced-kyc-level': 'tier_3',
    });
  });

  it('omits BOTH keys from levelToTier when the level env vars are absent (no undefined key)', () => {
    delete process.env['SUMSUB_LEVEL_TIER2'];
    delete process.env['SUMSUB_LEVEL_TIER3'];

    const cfg = configuration();

    expect(cfg.sumsub.levelToTier).toEqual({});
    expect(Object.keys(cfg.sumsub.levelToTier)).not.toContain('undefined');
  });

  it('omits only the absent level from levelToTier when just one of the two is set', () => {
    process.env['SUMSUB_LEVEL_TIER2'] = 'basic-kyc-level';
    delete process.env['SUMSUB_LEVEL_TIER3'];

    const cfg = configuration();

    expect(cfg.sumsub.levelToTier).toEqual({ 'basic-kyc-level': 'tier_2' });
  });

  it('treats an empty-string level env var the same as absent (no empty-string key)', () => {
    process.env['SUMSUB_LEVEL_TIER2'] = '';
    process.env['SUMSUB_LEVEL_TIER3'] = 'enhanced-kyc-level';

    const cfg = configuration();

    expect(cfg.sumsub.levelToTier).toEqual({ 'enhanced-kyc-level': 'tier_3' });
    expect(cfg.sumsub.levelToTier['']).toBeUndefined();
  });

  it('the committed defaults (no Sumsub level env vars) still pass boot validation', () => {
    delete process.env['SUMSUB_LEVEL_TIER2'];
    delete process.env['SUMSUB_LEVEL_TIER3'];

    expect(() => configuration()).not.toThrow();
  });
});
