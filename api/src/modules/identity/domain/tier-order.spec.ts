import { tierAtLeast } from './tier-order';

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
