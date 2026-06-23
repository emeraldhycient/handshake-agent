/**
 * TDD spec for buildBuyLedgerEntries — pure double-entry ledger domain.
 *
 * Hard invariants (per task-4.4-brief.md):
 *  1. Per-currency signed amounts sum to exactly 0.
 *  2. Every amount is non-zero; direction matches the sign.
 *  3. sequence === prev sequence + 1 per account.
 *  4. balanceAfter === prevBalance + signedAmount (exact decimal).
 *  5. ≥2 entries; deterministic order.
 */

import {
  buildBuyLedgerEntries,
  buildDepositLedgerEntries,
  buildSellLedgerEntries,
  LedgerError,
  LedgerAccountType,
  LedgerDirection,
  type AccountState,
  type BuildBuyLedgerInput,
  type BuildDepositLedgerInput,
  type BuildSellLedgerInput,
  type LedgerEntryDraft,
} from './ledger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decimal-safe sum of signed amounts for a given currency. */
function sumByCurrency(entries: LedgerEntryDraft[], currency: string): bigint {
  // Work in 18-decimal-place scaled integers to avoid float.
  const SCALE = 10n ** 18n;
  return entries
    .filter((e) => e.currency === currency)
    .reduce((acc, e) => {
      return acc + scaledBigInt(e.amount);
    }, 0n);

  function scaledBigInt(amount: string): bigint {
    // amount may be negative; we need to parse the sign separately.
    const isNeg = amount.startsWith('-');
    const abs = isNeg ? amount.slice(1) : amount;
    const [whole = '0', frac = ''] = abs.split('.');
    const fracPadded = frac.slice(0, 18).padEnd(18, '0');
    const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
    return isNeg ? -scaled : scaled;
  }
}

/** Make a fresh input with all accounts at {sequence:0, balance:'0'}. */
function freshInput(
  overrides?: Partial<BuildBuyLedgerInput>,
): BuildBuyLedgerInput {
  return {
    userId: 'user-1',
    walletId: 'wallet-abc',
    fiatAmount: '5000',
    processingFee: '100',
    cryptoAmount: '3.06',
    postedAt: new Date('2025-01-01T00:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildBuyLedgerEntries', () => {
  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildBuyLedgerEntries(freshInput());
    });

    it('returns at least 2 entries', () => {
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });

    it('has exactly 3 NGN entries and 2 USDT entries', () => {
      const ngn = entries.filter((e) => e.currency === 'NGN');
      const usdt = entries.filter((e) => e.currency === 'USDT');
      expect(ngn).toHaveLength(3);
      expect(usdt).toHaveLength(2);
    });

    it('NGN signed amounts sum to zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'NGN')).toBe(0n);
    });

    it('USDT signed amounts sum to zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('every amount is non-zero (invariant 2)', () => {
      const SCALE = 10n ** 18n;
      for (const e of entries) {
        // Value-based check: parse via BigInt scaling so any zero representation is caught.
        const isNeg = e.amount.startsWith('-');
        const abs = isNeg ? e.amount.slice(1) : e.amount;
        const [whole = '0', frac = ''] = abs.split('.');
        const fracPadded = frac.slice(0, 18).padEnd(18, '0');
        const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
        expect(scaled).not.toBe(0n);
      }
    });

    it('direction matches the sign of amount (invariant 2)', () => {
      for (const e of entries) {
        const isNeg = e.amount.startsWith('-');
        if (isNeg) {
          expect(e.direction).toBe(LedgerDirection.debit);
        } else {
          expect(e.direction).toBe(LedgerDirection.credit);
        }
      }
    });

    it('sequence is prevSequence + 1 for fresh accounts (invariant 3)', () => {
      for (const e of entries) {
        expect(e.sequence).toBe(1); // all start at 0, so next = 1
      }
    });

    it('balanceAfter equals 0 + signedAmount for fresh accounts (invariant 4)', () => {
      for (const e of entries) {
        // For fresh accounts prevBalance is '0', so balanceAfter === amount.
        expect(e.balanceAfter).toBe(e.amount);
      }
    });

    it('entries are in deterministic order (invariant 5)', () => {
      // Call twice and compare order.
      const a = buildBuyLedgerEntries(freshInput());
      const b = buildBuyLedgerEntries(freshInput());
      expect(
        a.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`),
      ).toEqual(b.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`));
    });

    it('processor_settlement / ngn_processor / NGN receives +fiatAmount (credit)', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.processor_settlement &&
          x.currency === 'NGN',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('5000');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('treasury_reserve / ngn_treasury / NGN is debited (fiatAmount − processingFee)', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.currency === 'NGN',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-4900');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('platform_float / ngn_fees / NGN is debited −processingFee', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.platform_float &&
          x.currency === 'NGN',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-100');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('user_wallet / walletId / USDT is credited +cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.user_wallet &&
          x.currency === 'USDT',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('3.06');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('treasury_reserve / usdt_treasury / USDT is debited −cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.currency === 'USDT',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-3.06');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('postedAt matches the input value', () => {
      const ts = new Date('2025-01-01T00:00:00Z');
      for (const e of entries) {
        expect(e.postedAt).toEqual(ts);
      }
    });

    it('description is a non-empty string for every entry', () => {
      for (const e of entries) {
        expect(typeof e.description).toBe('string');
        expect(e.description.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Non-zero prior account states
  // -------------------------------------------------------------------------

  describe('with non-zero prior account states', () => {
    it('advances sequence and balanceAfter from previous state', () => {
      const accountStates: Record<string, AccountState> = {
        'processor_settlement:ngn_processor:NGN': {
          sequence: 5,
          balance: '10000',
        },
        'treasury_reserve:ngn_treasury:NGN': {
          sequence: 3,
          balance: '500000',
        },
        'platform_float:ngn_fees:NGN': { sequence: 7, balance: '2000' },
        'user_wallet:wallet-abc:USDT': { sequence: 2, balance: '10.5' },
        'treasury_reserve:usdt_treasury:USDT': { sequence: 1, balance: '1000' },
      };

      const entries = buildBuyLedgerEntries(freshInput({ accountStates }));

      // processor_settlement: prev seq=5 → next=6; prev balance=10000 + 5000 = 15000
      const procEntry = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.processor_settlement &&
          e.currency === 'NGN',
      )!;
      expect(procEntry.sequence).toBe(6);
      expect(procEntry.balanceAfter).toBe('15000');

      // treasury_reserve NGN: prev seq=3 → next=4; prev balance=500000 + (-4900) = 495100
      const trsNgn = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.treasury_reserve &&
          e.currency === 'NGN',
      )!;
      expect(trsNgn.sequence).toBe(4);
      expect(trsNgn.balanceAfter).toBe('495100');

      // platform_float NGN: prev seq=7 → next=8; prev balance=2000 + (-100) = 1900
      const feeEntry = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.platform_float &&
          e.currency === 'NGN',
      )!;
      expect(feeEntry.sequence).toBe(8);
      expect(feeEntry.balanceAfter).toBe('1900');

      // user_wallet USDT: prev seq=2 → next=3; prev balance=10.5 + 3.06 = 13.56
      const walletEntry = entries.find(
        (e) => e.accountType === LedgerAccountType.user_wallet,
      )!;
      expect(walletEntry.sequence).toBe(3);
      expect(walletEntry.balanceAfter).toBe('13.56');

      // treasury_reserve USDT: prev seq=1 → next=2; prev balance=1000 + (-3.06) = 996.94
      const trsUsdt = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.treasury_reserve &&
          e.currency === 'USDT',
      )!;
      expect(trsUsdt.sequence).toBe(2);
      expect(trsUsdt.balanceAfter).toBe('996.94');
    });
  });

  // -------------------------------------------------------------------------
  // Property-style: per-currency sums are zero for multiple amount combos
  // -------------------------------------------------------------------------

  describe('property: per-currency sums are exactly 0 for various amounts', () => {
    const cases: Array<{
      fiatAmount: string;
      processingFee: string;
      cryptoAmount: string;
    }> = [
      { fiatAmount: '1000', processingFee: '20', cryptoAmount: '0.612' },
      {
        fiatAmount: '100000',
        processingFee: '2000',
        cryptoAmount: '59.876543',
      },
      { fiatAmount: '1', processingFee: '0.01', cryptoAmount: '0.000001' },
      {
        fiatAmount: '999999.99',
        processingFee: '19999.9998',
        cryptoAmount: '612.123456789012345678',
      },
    ];

    it.each(cases)(
      'NGN sum=0 and USDT sum=0 for fiat=$fiatAmount fee=$processingFee crypto=$cryptoAmount',
      ({ fiatAmount, processingFee, cryptoAmount }) => {
        const entries = buildBuyLedgerEntries(
          freshInput({ fiatAmount, processingFee, cryptoAmount }),
        );
        expect(sumByCurrency(entries, 'NGN')).toBe(0n);
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Guards — zero / negative inputs throw LedgerError
  // -------------------------------------------------------------------------

  describe('guards', () => {
    it('throws LedgerError when fiatAmount is zero', () => {
      expect(() =>
        buildBuyLedgerEntries(freshInput({ fiatAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when fiatAmount is negative', () => {
      expect(() =>
        buildBuyLedgerEntries(freshInput({ fiatAmount: '-100' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when processingFee is negative', () => {
      expect(() =>
        buildBuyLedgerEntries(freshInput({ processingFee: '-1' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is zero', () => {
      expect(() =>
        buildBuyLedgerEntries(freshInput({ cryptoAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is negative', () => {
      expect(() =>
        buildBuyLedgerEntries(freshInput({ cryptoAmount: '-0.5' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when processingFee >= fiatAmount', () => {
      expect(() =>
        buildBuyLedgerEntries(
          freshInput({ fiatAmount: '100', processingFee: '100' }),
        ),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when fiatAmount is not a valid decimal string', () => {
      expect(() =>
        buildBuyLedgerEntries(freshInput({ fiatAmount: 'abc' })),
      ).toThrow(LedgerError);
    });
  });

  // -------------------------------------------------------------------------
  // Zero processingFee — promotional / zero-fee tier
  // -------------------------------------------------------------------------

  describe('zero processingFee (promotional / zero-fee tier)', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildBuyLedgerEntries(freshInput({ processingFee: '0' }));
    });

    it('(a) no entry has a zero amount', () => {
      const SCALE = 10n ** 18n;
      for (const e of entries) {
        const isNeg = e.amount.startsWith('-');
        const abs = isNeg ? e.amount.slice(1) : e.amount;
        const [whole = '0', frac = ''] = abs.split('.');
        const fracPadded = frac.slice(0, 18).padEnd(18, '0');
        const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
        expect(scaled).not.toBe(0n);
      }
    });

    it('(b) NGN leg still sums to exactly zero', () => {
      expect(sumByCurrency(entries, 'NGN')).toBe(0n);
    });

    it('(c) exactly 2 NGN entries (no fee entry) and 2 USDT entries', () => {
      const ngn = entries.filter((e) => e.currency === 'NGN');
      const usdt = entries.filter((e) => e.currency === 'USDT');
      expect(ngn).toHaveLength(2);
      expect(usdt).toHaveLength(2);
    });

    it('no platform_float entry is emitted when fee is zero', () => {
      const feeEntry = entries.find(
        (e) => e.accountType === LedgerAccountType.platform_float,
      );
      expect(feeEntry).toBeUndefined();
    });

    it('treasury_reserve NGN is debited the full fiatAmount when fee is zero', () => {
      const trsNgn = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.treasury_reserve &&
          e.currency === 'NGN',
      );
      expect(trsNgn).toBeDefined();
      expect(trsNgn!.amount).toBe('-5000');
      expect(trsNgn!.direction).toBe(LedgerDirection.debit);
    });

    it('USDT leg is unaffected by zero fee', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      const usdt = entries.filter((e) => e.currency === 'USDT');
      expect(usdt).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------
// buildDepositLedgerEntries
// ---------------------------------------------------------------------------

/** Make a fresh deposit input with all accounts at {sequence:0, balance:'0'}. */
function freshDepositInput(
  overrides?: Partial<BuildDepositLedgerInput>,
): BuildDepositLedgerInput {
  return {
    walletId: 'wallet-deposit-abc',
    cryptoAmount: '5.5',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildDepositLedgerEntries', () => {
  // -------------------------------------------------------------------------
  // Guards — positive-amount enforcement (invariant 2)
  // -------------------------------------------------------------------------

  describe('guards', () => {
    it('throws LedgerError when cryptoAmount is zero', () => {
      expect(() =>
        buildDepositLedgerEntries(freshDepositInput({ cryptoAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is negative', () => {
      expect(() =>
        buildDepositLedgerEntries(freshDepositInput({ cryptoAmount: '-1' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is not a valid decimal', () => {
      expect(() =>
        buildDepositLedgerEntries(freshDepositInput({ cryptoAmount: 'abc' })),
      ).toThrow(LedgerError);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path — fresh account states
  // -------------------------------------------------------------------------

  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildDepositLedgerEntries(freshDepositInput());
    });

    it('returns exactly 2 entries (invariant 5)', () => {
      expect(entries).toHaveLength(2);
    });

    it('USDT signed amounts sum to zero per-currency (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('every amount is non-zero (invariant 2)', () => {
      const SCALE = 10n ** 18n;
      for (const e of entries) {
        const isNeg = e.amount.startsWith('-');
        const abs = isNeg ? e.amount.slice(1) : e.amount;
        const [whole = '0', frac = ''] = abs.split('.');
        const fracPadded = frac.slice(0, 18).padEnd(18, '0');
        const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
        expect(scaled).not.toBe(0n);
      }
    });

    it('sequence is prevSequence + 1 for fresh accounts (invariant 3)', () => {
      for (const e of entries) {
        expect(e.sequence).toBe(1);
      }
    });

    it('balanceAfter equals 0 + signedAmount for fresh accounts (invariant 4)', () => {
      for (const e of entries) {
        expect(e.balanceAfter).toBe(e.amount);
      }
    });

    it('user_wallet / walletId / USDT is credited +cryptoAmount (correct direction)', () => {
      const userEntry = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.user_wallet &&
          e.accountId === 'wallet-deposit-abc' &&
          e.currency === 'USDT',
      );
      expect(userEntry).toBeDefined();
      expect(userEntry!.amount).toBe('5.5');
      expect(userEntry!.direction).toBe(LedgerDirection.credit);
    });

    it('clearing / usdt_external_deposits / USDT is debited −cryptoAmount (correct direction)', () => {
      const clearingEntry = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.clearing &&
          e.accountId === 'usdt_external_deposits' &&
          e.currency === 'USDT',
      );
      expect(clearingEntry).toBeDefined();
      expect(clearingEntry!.amount).toBe('-5.5');
      expect(clearingEntry!.direction).toBe(LedgerDirection.debit);
    });
  });

  // -------------------------------------------------------------------------
  // Non-zero prior account states — sequence + balanceAfter advance correctly
  // -------------------------------------------------------------------------

  describe('with non-zero prior account states (invariants 3 & 4)', () => {
    it('advances sequence and balanceAfter from previous state', () => {
      const accountStates: Record<string, AccountState> = {
        'user_wallet:wallet-deposit-abc:USDT': {
          sequence: 4,
          balance: '20.0',
        },
        'clearing:usdt_external_deposits:USDT': {
          sequence: 2,
          balance: '-30.0',
        },
      };

      const entries = buildDepositLedgerEntries(
        freshDepositInput({ cryptoAmount: '10', accountStates }),
      );

      // user_wallet: prev seq=4 → next=5; prev balance=20.0 + 10 = 30
      const userEntry = entries.find(
        (e) => e.accountType === LedgerAccountType.user_wallet,
      )!;
      expect(userEntry.sequence).toBe(5);
      expect(userEntry.balanceAfter).toBe('30');

      // clearing: prev seq=2 → next=3; prev balance=-30.0 + (-10) = -40
      const clearingEntry = entries.find(
        (e) => e.accountType === LedgerAccountType.clearing,
      )!;
      expect(clearingEntry.sequence).toBe(3);
      expect(clearingEntry.balanceAfter).toBe('-40');
    });
  });

  // -------------------------------------------------------------------------
  // Property: per-currency sum is zero for various deposit amounts
  // -------------------------------------------------------------------------

  describe('property: USDT signed amounts sum to 0 for various deposit sizes', () => {
    const cases = [
      { cryptoAmount: '0.000001' },
      { cryptoAmount: '1' },
      { cryptoAmount: '100.5' },
      { cryptoAmount: '999999.123456789012345678' },
    ];

    it.each(cases)(
      'USDT sum=0 for cryptoAmount=$cryptoAmount',
      ({ cryptoAmount }) => {
        const entries = buildDepositLedgerEntries(
          freshDepositInput({ cryptoAmount }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// buildSellLedgerEntries (task S4a)
// ---------------------------------------------------------------------------

/** Make a fresh sell input with all accounts at {sequence:0, balance:'0'}. */
function freshSellInput(
  overrides?: Partial<BuildSellLedgerInput>,
): BuildSellLedgerInput {
  return {
    walletId: 'wallet-sell-abc',
    cryptoAmount: '5.0',
    netFiatAmount: '7500',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildSellLedgerEntries', () => {
  // -------------------------------------------------------------------------
  // Happy path — fresh account states
  // -------------------------------------------------------------------------

  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildSellLedgerEntries(freshSellInput());
    });

    it('returns exactly 4 entries (2 USDT + 2 NGN)', () => {
      expect(entries).toHaveLength(4);
    });

    it('has exactly 2 USDT entries and 2 NGN entries (invariant 5)', () => {
      const usdt = entries.filter((e) => e.currency === 'USDT');
      const ngn = entries.filter((e) => e.currency === 'NGN');
      expect(usdt).toHaveLength(2);
      expect(ngn).toHaveLength(2);
    });

    it('USDT signed amounts sum to exactly zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('NGN signed amounts sum to exactly zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'NGN')).toBe(0n);
    });

    it('every amount is non-zero (invariant 2)', () => {
      const SCALE = 10n ** 18n;
      for (const e of entries) {
        const isNeg = e.amount.startsWith('-');
        const abs = isNeg ? e.amount.slice(1) : e.amount;
        const [whole = '0', frac = ''] = abs.split('.');
        const fracPadded = frac.slice(0, 18).padEnd(18, '0');
        const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
        expect(scaled).not.toBe(0n);
      }
    });

    it('direction matches the sign of amount (invariant 2)', () => {
      for (const e of entries) {
        const isNeg = e.amount.startsWith('-');
        if (isNeg) {
          expect(e.direction).toBe(LedgerDirection.debit);
        } else {
          expect(e.direction).toBe(LedgerDirection.credit);
        }
      }
    });

    it('sequence is 1 for fresh accounts (invariant 3)', () => {
      for (const e of entries) {
        expect(e.sequence).toBe(1);
      }
    });

    it('balanceAfter equals normalised signedAmount for fresh accounts (invariant 4)', () => {
      // fromScaled normalises trailing zeros: '5.0' → '5', '-5.0' → '-5'.
      // For fresh (zero-balance) accounts, balanceAfter equals the normalised amount.
      for (const e of entries) {
        expect(e.balanceAfter).toBe(e.amount);
      }
    });

    it('entries are in deterministic order (invariant 5)', () => {
      const a = buildSellLedgerEntries(freshSellInput());
      const b = buildSellLedgerEntries(freshSellInput());
      expect(
        a.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`),
      ).toEqual(b.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`));
    });

    it('user_wallet / walletId / USDT is debited −cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.user_wallet &&
          x.currency === 'USDT',
      );
      expect(e).toBeDefined();
      // fromScaled normalises: '-5.0' → '-5'
      expect(e!.amount).toBe('-5');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('treasury_reserve / usdt_treasury / USDT is credited +cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.currency === 'USDT',
      );
      expect(e).toBeDefined();
      // fromScaled normalises: '5.0' → '5'
      expect(e!.amount).toBe('5');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('treasury_reserve / ngn_treasury / NGN is debited −netFiatAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.currency === 'NGN',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-7500');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('processor_settlement / ngn_payout / NGN is credited +netFiatAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.processor_settlement &&
          x.currency === 'NGN',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('7500');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('description is a non-empty string for every entry', () => {
      for (const e of entries) {
        expect(typeof e.description).toBe('string');
        expect(e.description.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Non-zero prior account states (invariants 3 & 4)
  // -------------------------------------------------------------------------

  describe('with non-zero prior account states', () => {
    it('advances sequence and balanceAfter from previous state', () => {
      const accountStates: Record<string, AccountState> = {
        'user_wallet:wallet-sell-abc:USDT': { sequence: 3, balance: '20.0' },
        'treasury_reserve:usdt_treasury:USDT': { sequence: 2, balance: '1000' },
        'treasury_reserve:ngn_treasury:NGN': { sequence: 5, balance: '500000' },
        'processor_settlement:ngn_payout:NGN': { sequence: 1, balance: '0' },
      };

      const entries = buildSellLedgerEntries(freshSellInput({ accountStates }));

      // user_wallet USDT: seq 3 → 4; balance 20.0 + (-5.0) = 15.0
      const userEntry = entries.find(
        (e) => e.accountType === LedgerAccountType.user_wallet,
      )!;
      expect(userEntry.sequence).toBe(4);
      expect(userEntry.balanceAfter).toBe('15');

      // treasury_reserve USDT: seq 2 → 3; balance 1000 + 5.0 = 1005.0
      const trsUsdt = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.treasury_reserve &&
          e.currency === 'USDT',
      )!;
      expect(trsUsdt.sequence).toBe(3);
      expect(trsUsdt.balanceAfter).toBe('1005');

      // treasury_reserve NGN: seq 5 → 6; balance 500000 + (-7500) = 492500
      const trsNgn = entries.find(
        (e) =>
          e.accountType === LedgerAccountType.treasury_reserve &&
          e.currency === 'NGN',
      )!;
      expect(trsNgn.sequence).toBe(6);
      expect(trsNgn.balanceAfter).toBe('492500');

      // processor_settlement NGN: seq 1 → 2; balance 0 + 7500 = 7500
      const payoutEntry = entries.find(
        (e) => e.accountType === LedgerAccountType.processor_settlement,
      )!;
      expect(payoutEntry.sequence).toBe(2);
      expect(payoutEntry.balanceAfter).toBe('7500');
    });
  });

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  describe('guards', () => {
    it('throws LedgerError when cryptoAmount is zero', () => {
      expect(() =>
        buildSellLedgerEntries(freshSellInput({ cryptoAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is negative', () => {
      expect(() =>
        buildSellLedgerEntries(freshSellInput({ cryptoAmount: '-1' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is not a valid decimal', () => {
      expect(() =>
        buildSellLedgerEntries(freshSellInput({ cryptoAmount: 'abc' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when netFiatAmount is zero', () => {
      expect(() =>
        buildSellLedgerEntries(freshSellInput({ netFiatAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when netFiatAmount is negative', () => {
      expect(() =>
        buildSellLedgerEntries(freshSellInput({ netFiatAmount: '-100' })),
      ).toThrow(LedgerError);
    });
  });

  // -------------------------------------------------------------------------
  // Property: per-currency sums = 0 for various amounts
  // -------------------------------------------------------------------------

  describe('property: per-currency sums are exactly 0 for various amounts', () => {
    const cases: Array<{ cryptoAmount: string; netFiatAmount: string }> = [
      { cryptoAmount: '0.000001', netFiatAmount: '0.15' },
      { cryptoAmount: '1', netFiatAmount: '1550' },
      { cryptoAmount: '100.5', netFiatAmount: '149000.50' },
      {
        cryptoAmount: '999999.123456789012345678',
        netFiatAmount: '1549998641.234567890123456',
      },
    ];

    it.each(cases)(
      'USDT sum=0 and NGN sum=0 for crypto=$cryptoAmount fiat=$netFiatAmount',
      ({ cryptoAmount, netFiatAmount }) => {
        const entries = buildSellLedgerEntries(
          freshSellInput({ cryptoAmount, netFiatAmount }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
        expect(sumByCurrency(entries, 'NGN')).toBe(0n);
      },
    );
  });
});
