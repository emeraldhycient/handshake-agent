import { meetsCapabilityMinTier, tierAtLeast } from './tier-order';

describe('tierAtLeast', () => {
  it('orders tiers', () => {
    expect(tierAtLeast('tier_2', 'tier_2')).toBe(true);
    expect(tierAtLeast('tier_1', 'tier_2')).toBe(false);
    expect(tierAtLeast('tier_3', 'tier_2')).toBe(true);
    expect(tierAtLeast('unverified', 'tier_1')).toBe(false);
  });

  it('a higher tier satisfies a lower requirement', () => {
    expect(tierAtLeast('tier_3', 'tier_1')).toBe(true);
  });

  it('unverified satisfies an unverified requirement (reflexive at the floor)', () => {
    expect(tierAtLeast('unverified', 'unverified')).toBe(true);
  });
});

describe('meetsCapabilityMinTier', () => {
  const map = {
    'crypto.buy': 'tier_1',
    'crypto.receive': 'tier_1',
    'crypto.sell': 'tier_2',
    'crypto.send': 'tier_2',
    'crypto.swap': 'tier_2',
  } as const;

  it('a tier_1 user meets a tier_1-gated capability (buy/receive)', () => {
    expect(meetsCapabilityMinTier('tier_1', 'crypto.buy', map)).toBe(true);
    expect(meetsCapabilityMinTier('tier_1', 'crypto.receive', map)).toBe(true);
  });

  it('a tier_1 user does NOT meet a tier_2-gated capability (sell/send/swap)', () => {
    expect(meetsCapabilityMinTier('tier_1', 'crypto.sell', map)).toBe(false);
    expect(meetsCapabilityMinTier('tier_1', 'crypto.send', map)).toBe(false);
    expect(meetsCapabilityMinTier('tier_1', 'crypto.swap', map)).toBe(false);
  });

  it('a tier_2 user meets both tier_1- and tier_2-gated capabilities', () => {
    expect(meetsCapabilityMinTier('tier_2', 'crypto.buy', map)).toBe(true);
    expect(meetsCapabilityMinTier('tier_2', 'crypto.send', map)).toBe(true);
  });

  it('an unverified user meets nothing', () => {
    expect(meetsCapabilityMinTier('unverified', 'crypto.buy', map)).toBe(false);
  });

  it('fails closed to tier_2 for a capability with no configured map entry', () => {
    expect(meetsCapabilityMinTier('tier_1', 'crypto.unknown', map)).toBe(false);
    expect(meetsCapabilityMinTier('tier_2', 'crypto.unknown', map)).toBe(true);
  });
});
