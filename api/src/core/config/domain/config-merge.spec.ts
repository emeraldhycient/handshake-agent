import { getAtPath, setAtPath, applyOverrides } from './config-merge';

describe('getAtPath', () => {
  const obj = {
    pricing: { assets: { USDT: { buySpreadBps: 150 } } },
    flag: true,
  };

  it('reads a nested value by dot-path', () => {
    expect(getAtPath(obj, 'pricing.assets.USDT.buySpreadBps')).toBe(150);
    expect(getAtPath(obj, 'flag')).toBe(true);
  });

  it('returns undefined for a missing path', () => {
    expect(getAtPath(obj, 'pricing.assets.BTC.buySpreadBps')).toBeUndefined();
    expect(getAtPath(obj, 'nope.nope')).toBeUndefined();
  });
});

describe('setAtPath', () => {
  it('sets a nested value and returns a NEW object (original unchanged)', () => {
    const base = { pricing: { assets: { USDT: { buySpreadBps: 150 } } } };
    const next = setAtPath(base, 'pricing.assets.USDT.buySpreadBps', 200);
    expect(getAtPath(next, 'pricing.assets.USDT.buySpreadBps')).toBe(200);
    // original is untouched (immutability — the base config must never mutate)
    expect(base.pricing.assets.USDT.buySpreadBps).toBe(150);
    expect(next).not.toBe(base);
    expect(next.pricing).not.toBe(base.pricing);
  });

  it('leaves sibling values intact', () => {
    const base = {
      pricing: {
        processingFeeBps: 100,
        assets: { USDT: { buySpreadBps: 150 } },
      },
    };
    const next = setAtPath(base, 'pricing.processingFeeBps', 250);
    expect(getAtPath(next, 'pricing.processingFeeBps')).toBe(250);
    expect(getAtPath(next, 'pricing.assets.USDT.buySpreadBps')).toBe(150);
  });

  it('creates intermediate objects when the path does not yet exist', () => {
    const next = setAtPath({}, 'a.b.c', 7);
    expect(getAtPath(next, 'a.b.c')).toBe(7);
  });
});

describe('applyOverrides', () => {
  it('overlays only the given keys, leaving the rest of base intact and unmutated', () => {
    const base = {
      pricing: {
        processingFeeBps: 100,
        assets: { USDT: { buySpreadBps: 150 } },
      },
      limits: { NGN: { tier_1: { perTxFiatMax: 50000 } } },
    };
    const merged = applyOverrides(base, [
      { key: 'pricing.assets.USDT.buySpreadBps', value: 175 },
      { key: 'limits.NGN.tier_1.perTxFiatMax', value: 80000 },
    ]);
    expect(getAtPath(merged, 'pricing.assets.USDT.buySpreadBps')).toBe(175);
    expect(getAtPath(merged, 'limits.NGN.tier_1.perTxFiatMax')).toBe(80000);
    // untouched
    expect(getAtPath(merged, 'pricing.processingFeeBps')).toBe(100);
    // base unmutated
    expect(base.pricing.assets.USDT.buySpreadBps).toBe(150);
  });

  it('returns an equivalent (structurally) config when there are no overrides', () => {
    const base = { pricing: { processingFeeBps: 100 } };
    expect(applyOverrides(base, [])).toEqual(base);
  });
});
