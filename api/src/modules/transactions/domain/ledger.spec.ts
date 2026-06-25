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
  buildSellReserveEntries,
  buildSellFinalizeEntries,
  buildSellRefundEntries,
  buildSendReserveEntries,
  buildSendFinalizeEntries,
  buildSendRefundEntries,
  LedgerError,
  LedgerAccountType,
  LedgerDirection,
  type AccountState,
  type BuildBuyLedgerInput,
  type BuildDepositLedgerInput,
  type BuildSellReserveInput,
  type BuildSellFinalizeInput,
  type BuildSellRefundInput,
  type BuildSendReserveInput,
  type BuildSendFinalizeInput,
  type BuildSendRefundInput,
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
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
    // Task 2: fiatCurrency required; default to 'NGN' so existing NGN-path tests stay green.
    fiatCurrency: 'NGN',
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
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
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
// buildSellReserveEntries (task S4b — phase 1: reserve at execute)
// NOTE: buildSellLedgerEntries was removed in task S4b-fix; it is superseded by
// the two-phase builders: buildSellReserveEntries + buildSellFinalizeEntries.
// ---------------------------------------------------------------------------

function freshSellReserveInput(
  overrides?: Partial<BuildSellReserveInput>,
): BuildSellReserveInput {
  return {
    walletId: 'wallet-reserve-abc',
    cryptoAmount: '5.0',
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildSellReserveEntries', () => {
  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildSellReserveEntries(freshSellReserveInput());
    });

    it('returns exactly 2 entries', () => {
      expect(entries).toHaveLength(2);
    });

    it('USDT signed amounts sum to exactly zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('no NGN entries', () => {
      expect(entries.filter((e) => e.currency === 'NGN')).toHaveLength(0);
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
      for (const e of entries) {
        expect(e.balanceAfter).toBe(e.amount);
      }
    });

    it('user_wallet is debited −cryptoAmount', () => {
      const e = entries.find(
        (x) => x.accountType === LedgerAccountType.user_wallet,
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-5');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('clearing / usdt_sell_clearing is credited +cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.clearing &&
          x.accountId === 'usdt_sell_clearing',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('5');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('entries are in deterministic order (invariant 5)', () => {
      const a = buildSellReserveEntries(freshSellReserveInput());
      const b = buildSellReserveEntries(freshSellReserveInput());
      expect(
        a.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`),
      ).toEqual(b.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`));
    });
  });

  describe('guards', () => {
    it('throws LedgerError when cryptoAmount is zero', () => {
      expect(() =>
        buildSellReserveEntries(freshSellReserveInput({ cryptoAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is negative', () => {
      expect(() =>
        buildSellReserveEntries(
          freshSellReserveInput({ cryptoAmount: '-1.0' }),
        ),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is not a valid decimal', () => {
      expect(() =>
        buildSellReserveEntries(freshSellReserveInput({ cryptoAmount: 'abc' })),
      ).toThrow(LedgerError);
    });
  });

  describe('property: USDT sum=0 for various amounts', () => {
    const cases = [
      { cryptoAmount: '0.000001' },
      { cryptoAmount: '1' },
      { cryptoAmount: '100.5' },
      { cryptoAmount: '999999.123456789012345678' },
    ];

    it.each(cases)(
      'USDT sum=0 for cryptoAmount=$cryptoAmount',
      ({ cryptoAmount }) => {
        const entries = buildSellReserveEntries(
          freshSellReserveInput({ cryptoAmount }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// buildSellFinalizeEntries (task S4b — phase 2a: finalize on payout success)
// ---------------------------------------------------------------------------

function freshSellFinalizeInput(
  overrides?: Partial<BuildSellFinalizeInput>,
): BuildSellFinalizeInput {
  return {
    walletId: 'wallet-finalize-abc',
    cryptoAmount: '5.0',
    netFiatAmount: '7500',
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildSellFinalizeEntries', () => {
  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildSellFinalizeEntries(freshSellFinalizeInput());
    });

    it('returns exactly 4 entries (2 USDT + 2 NGN)', () => {
      expect(entries).toHaveLength(4);
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

    it('direction matches sign (invariant 2)', () => {
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

    it('clearing / usdt_sell_clearing / USDT is debited −cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.clearing &&
          x.accountId === 'usdt_sell_clearing' &&
          x.currency === 'USDT',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-5');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('treasury_reserve / usdt_treasury / USDT is credited +cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.accountId === 'usdt_treasury' &&
          x.currency === 'USDT',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('5');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('treasury_reserve / ngn_treasury / NGN is debited −netFiatAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.accountId === 'ngn_treasury' &&
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
          x.accountId === 'ngn_payout' &&
          x.currency === 'NGN',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('7500');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });
  });

  describe('guards', () => {
    it('throws LedgerError when cryptoAmount is zero', () => {
      expect(() =>
        buildSellFinalizeEntries(freshSellFinalizeInput({ cryptoAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when netFiatAmount is zero', () => {
      expect(() =>
        buildSellFinalizeEntries(
          freshSellFinalizeInput({ netFiatAmount: '0' }),
        ),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when netFiatAmount is negative', () => {
      expect(() =>
        buildSellFinalizeEntries(
          freshSellFinalizeInput({ netFiatAmount: '-100' }),
        ),
      ).toThrow(LedgerError);
    });
  });

  describe('property: per-currency sums = 0 for various amounts', () => {
    const cases = [
      { cryptoAmount: '0.000001', netFiatAmount: '0.15' },
      { cryptoAmount: '1', netFiatAmount: '1550' },
      { cryptoAmount: '100.5', netFiatAmount: '149000.50' },
    ];

    it.each(cases)(
      'USDT sum=0 and NGN sum=0 for crypto=$cryptoAmount fiat=$netFiatAmount',
      ({ cryptoAmount, netFiatAmount }) => {
        const entries = buildSellFinalizeEntries(
          freshSellFinalizeInput({ cryptoAmount, netFiatAmount }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
        expect(sumByCurrency(entries, 'NGN')).toBe(0n);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// buildSellRefundEntries (task S4b — phase 2b: refund on payout failure)
// ---------------------------------------------------------------------------

function freshSellRefundInput(
  overrides?: Partial<BuildSellRefundInput>,
): BuildSellRefundInput {
  return {
    walletId: 'wallet-refund-abc',
    cryptoAmount: '5.0',
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildSellRefundEntries', () => {
  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildSellRefundEntries(freshSellRefundInput());
    });

    it('returns exactly 2 entries', () => {
      expect(entries).toHaveLength(2);
    });

    it('USDT signed amounts sum to exactly zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('no NGN entries', () => {
      expect(entries.filter((e) => e.currency === 'NGN')).toHaveLength(0);
    });

    it('clearing / usdt_sell_clearing is debited −cryptoAmount (mirrors reserve credit)', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.clearing &&
          x.accountId === 'usdt_sell_clearing',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-5');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('user_wallet is credited +cryptoAmount (refund to user)', () => {
      const e = entries.find(
        (x) => x.accountType === LedgerAccountType.user_wallet,
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('5');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('reserve → refund round-trip: USDT sums cancel', () => {
      // Reserve: user_wallet −5, clearing +5.  Sum = 0.
      // Refund:  clearing −5, user_wallet +5.  Sum = 0.
      // Together (different transactions): each independently balanced.
      const reserve = buildSellReserveEntries(
        freshSellReserveInput({ cryptoAmount: '5.0' }),
      );
      const refund = buildSellRefundEntries(
        freshSellRefundInput({ cryptoAmount: '5.0' }),
      );
      const combined = [...reserve, ...refund];
      expect(sumByCurrency(combined, 'USDT')).toBe(0n);
    });
  });

  describe('guards', () => {
    it('throws LedgerError when cryptoAmount is zero', () => {
      expect(() =>
        buildSellRefundEntries(freshSellRefundInput({ cryptoAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is negative', () => {
      expect(() =>
        buildSellRefundEntries(freshSellRefundInput({ cryptoAmount: '-1' })),
      ).toThrow(LedgerError);
    });
  });

  describe('property: USDT sum=0 for various amounts', () => {
    const cases = [
      { cryptoAmount: '0.000001' },
      { cryptoAmount: '1' },
      { cryptoAmount: '100.5' },
      { cryptoAmount: '999999.123456789012345678' },
    ];

    it.each(cases)(
      'USDT sum=0 for cryptoAmount=$cryptoAmount',
      ({ cryptoAmount }) => {
        const entries = buildSellRefundEntries(
          freshSellRefundInput({ cryptoAmount }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// buildSendReserveEntries (task N3a — phase 1: reserve at propose)
// ---------------------------------------------------------------------------

function freshSendReserveInput(
  overrides?: Partial<BuildSendReserveInput>,
): BuildSendReserveInput {
  return {
    walletId: 'wallet-send-reserve-abc',
    totalDebit: '11.0', // e.g. 10 USDT send + 1 USDT fee
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildSendReserveEntries', () => {
  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildSendReserveEntries(freshSendReserveInput());
    });

    it('returns exactly 2 entries', () => {
      expect(entries).toHaveLength(2);
    });

    it('USDT signed amounts sum to exactly zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('no NGN entries', () => {
      expect(entries.filter((e) => e.currency === 'NGN')).toHaveLength(0);
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
      for (const e of entries) {
        expect(e.balanceAfter).toBe(e.amount);
      }
    });

    it('user_wallet is debited −totalDebit', () => {
      const e = entries.find(
        (x) => x.accountType === LedgerAccountType.user_wallet,
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-11');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('clearing / usdt_send_clearing is credited +totalDebit', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.clearing &&
          x.accountId === 'usdt_send_clearing',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('11');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('entries are in deterministic order (invariant 5)', () => {
      const a = buildSendReserveEntries(freshSendReserveInput());
      const b = buildSendReserveEntries(freshSendReserveInput());
      expect(
        a.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`),
      ).toEqual(b.map((e) => `${e.accountType}:${e.accountId}:${e.currency}`));
    });
  });

  describe('guards', () => {
    it('throws LedgerError when totalDebit is zero', () => {
      expect(() =>
        buildSendReserveEntries(freshSendReserveInput({ totalDebit: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when totalDebit is negative', () => {
      expect(() =>
        buildSendReserveEntries(freshSendReserveInput({ totalDebit: '-1' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when totalDebit is not a valid decimal', () => {
      expect(() =>
        buildSendReserveEntries(freshSendReserveInput({ totalDebit: 'abc' })),
      ).toThrow(LedgerError);
    });
  });

  describe('property: USDT sum=0 for various amounts', () => {
    const sendReserveCases = [
      { totalDebit: '0.000002' },
      { totalDebit: '1.5' },
      { totalDebit: '100.5' },
      { totalDebit: '999999.123456789012345678' },
    ];

    it.each(sendReserveCases)(
      'USDT sum=0 for totalDebit=$totalDebit',
      ({ totalDebit }) => {
        const entries = buildSendReserveEntries(
          freshSendReserveInput({ totalDebit }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// buildSendFinalizeEntries (task N3a — phase 2a: finalize on broadcast confirm)
// ---------------------------------------------------------------------------

function freshSendFinalizeInput(
  overrides?: Partial<BuildSendFinalizeInput>,
): BuildSendFinalizeInput {
  return {
    walletId: 'wallet-send-finalize-abc',
    cryptoAmount: '10.0',
    networkFeeCrypto: '1.0',
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildSendFinalizeEntries', () => {
  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildSendFinalizeEntries(freshSendFinalizeInput());
    });

    it('returns exactly 3 entries (3 USDT)', () => {
      expect(entries).toHaveLength(3);
    });

    it('USDT signed amounts sum to exactly zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('no NGN entries', () => {
      expect(entries.filter((e) => e.currency === 'NGN')).toHaveLength(0);
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

    it('direction matches sign (invariant 2)', () => {
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

    it('clearing / usdt_send_clearing is debited −(cryptoAmount+networkFeeCrypto)', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.clearing &&
          x.accountId === 'usdt_send_clearing',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-11');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('treasury_reserve / usdt_network_out is credited +cryptoAmount', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.accountId === 'usdt_network_out',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('10');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('treasury_reserve / usdt_fees is credited +networkFeeCrypto', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.treasury_reserve &&
          x.accountId === 'usdt_fees',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('1');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });
  });

  describe('guards', () => {
    it('throws LedgerError when cryptoAmount is zero', () => {
      expect(() =>
        buildSendFinalizeEntries(freshSendFinalizeInput({ cryptoAmount: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when networkFeeCrypto is zero', () => {
      expect(() =>
        buildSendFinalizeEntries(
          freshSendFinalizeInput({ networkFeeCrypto: '0' }),
        ),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when cryptoAmount is negative', () => {
      expect(() =>
        buildSendFinalizeEntries(
          freshSendFinalizeInput({ cryptoAmount: '-1' }),
        ),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when networkFeeCrypto is negative', () => {
      expect(() =>
        buildSendFinalizeEntries(
          freshSendFinalizeInput({ networkFeeCrypto: '-0.5' }),
        ),
      ).toThrow(LedgerError);
    });
  });

  describe('property: USDT sum=0 for various amounts', () => {
    const sendFinalizeCases = [
      { cryptoAmount: '0.5', networkFeeCrypto: '0.000001' },
      { cryptoAmount: '1', networkFeeCrypto: '1' },
      { cryptoAmount: '100.5', networkFeeCrypto: '2.5' },
      { cryptoAmount: '999999.123456', networkFeeCrypto: '1.5' },
    ];

    it.each(sendFinalizeCases)(
      'USDT sum=0 for crypto=$cryptoAmount fee=$networkFeeCrypto',
      ({ cryptoAmount, networkFeeCrypto }) => {
        const entries = buildSendFinalizeEntries(
          freshSendFinalizeInput({ cryptoAmount, networkFeeCrypto }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      },
    );
  });

  it('reserve → finalize round-trip: net USDT across both phases = 0', () => {
    const reserve = buildSendReserveEntries(
      freshSendReserveInput({ totalDebit: '11.0' }),
    );
    const finalize = buildSendFinalizeEntries(
      freshSendFinalizeInput({ cryptoAmount: '10.0', networkFeeCrypto: '1.0' }),
    );
    const combined = [...reserve, ...finalize];
    expect(sumByCurrency(combined, 'USDT')).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// buildSendRefundEntries (task N3a — phase 2b: refund on broadcast failure)
// ---------------------------------------------------------------------------

function freshSendRefundInput(
  overrides?: Partial<BuildSendRefundInput>,
): BuildSendRefundInput {
  return {
    walletId: 'wallet-send-refund-abc',
    totalDebit: '11.0',
    // WN-4: asset required; default to 'USDT' so existing USDT-path tests stay green.
    asset: 'USDT',
    postedAt: new Date('2025-06-01T12:00:00Z'),
    accountStates: {},
    ...overrides,
  };
}

describe('buildSendRefundEntries', () => {
  describe('happy path — fresh account states', () => {
    let entries: LedgerEntryDraft[];

    beforeAll(() => {
      entries = buildSendRefundEntries(freshSendRefundInput());
    });

    it('returns exactly 2 entries', () => {
      expect(entries).toHaveLength(2);
    });

    it('USDT signed amounts sum to exactly zero (invariant 1)', () => {
      expect(sumByCurrency(entries, 'USDT')).toBe(0n);
    });

    it('no NGN entries', () => {
      expect(entries.filter((e) => e.currency === 'NGN')).toHaveLength(0);
    });

    it('clearing / usdt_send_clearing is debited −totalDebit (mirrors reserve credit)', () => {
      const e = entries.find(
        (x) =>
          x.accountType === LedgerAccountType.clearing &&
          x.accountId === 'usdt_send_clearing',
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('-11');
      expect(e!.direction).toBe(LedgerDirection.debit);
    });

    it('user_wallet is credited +totalDebit (refund to user)', () => {
      const e = entries.find(
        (x) => x.accountType === LedgerAccountType.user_wallet,
      );
      expect(e).toBeDefined();
      expect(e!.amount).toBe('11');
      expect(e!.direction).toBe(LedgerDirection.credit);
    });

    it('reserve → refund round-trip: USDT sums cancel', () => {
      const reserve = buildSendReserveEntries(
        freshSendReserveInput({ totalDebit: '11.0' }),
      );
      const refund = buildSendRefundEntries(
        freshSendRefundInput({ totalDebit: '11.0' }),
      );
      const combined = [...reserve, ...refund];
      expect(sumByCurrency(combined, 'USDT')).toBe(0n);
    });
  });

  describe('guards', () => {
    it('throws LedgerError when totalDebit is zero', () => {
      expect(() =>
        buildSendRefundEntries(freshSendRefundInput({ totalDebit: '0' })),
      ).toThrow(LedgerError);
    });

    it('throws LedgerError when totalDebit is negative', () => {
      expect(() =>
        buildSendRefundEntries(freshSendRefundInput({ totalDebit: '-1' })),
      ).toThrow(LedgerError);
    });
  });

  describe('property: USDT sum=0 for various amounts', () => {
    const sendRefundCases = [
      { totalDebit: '0.000001' },
      { totalDebit: '1' },
      { totalDebit: '100.5' },
      { totalDebit: '999999.123456789012345678' },
    ];

    it.each(sendRefundCases)(
      'USDT sum=0 for totalDebit=$totalDebit',
      ({ totalDebit }) => {
        const entries = buildSendRefundEntries(
          freshSendRefundInput({ totalDebit }),
        );
        expect(sumByCurrency(entries, 'USDT')).toBe(0n);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// WN-4: Multi-asset parameterization — non-USDT (USDC) builder tests
// All builders must use the passed `asset` string, not a hardcoded literal.
// ---------------------------------------------------------------------------

const USDC = 'USDC';

// ---------------------------------------------------------------------------
// Task 2: fiatCurrency threading — NGN unchanged + non-NGN (USD) threading
// ---------------------------------------------------------------------------

describe('Task 2: buildBuyLedgerEntries — fiatCurrency threading', () => {
  const baseInput = {
    userId: 'u1',
    walletId: 'w1',
    fiatAmount: '5000',
    cryptoAmount: '3.06',
    processingFee: '50',
    asset: 'USDT',
    postedAt: new Date('2026-06-25T00:00:00Z'),
    accountStates: {},
  } as const;

  it('labels NGN fiat legs with the threaded fiatCurrency (unchanged for NGN)', () => {
    const entries = buildBuyLedgerEntries({
      ...baseInput,
      fiatCurrency: 'NGN',
    });
    const fiatLegs = entries.filter((e) => e.currency === 'NGN');
    expect(fiatLegs.length).toBeGreaterThan(0);
    expect(fiatLegs.map((e) => e.accountId)).toEqual(
      expect.arrayContaining(['ngn_processor', 'ngn_treasury']),
    );
  });

  it('threads a non-NGN fiatCurrency into leg currency and account ids (no NGN literal)', () => {
    const entries = buildBuyLedgerEntries({
      ...baseInput,
      fiatCurrency: 'USD',
    });
    const fiatLegs = entries.filter((e) => e.currency === 'USD');
    expect(fiatLegs.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.currency === 'NGN')).toBe(false);
    expect(fiatLegs.map((e) => e.accountId)).toEqual(
      expect.arrayContaining(['usd_processor', 'usd_treasury']),
    );
  });
});

describe('WN-4: buildBuyLedgerEntries — non-USDT asset (USDC)', () => {
  it('crypto legs keyed by USDC, not USDT', () => {
    const entries = buildBuyLedgerEntries({
      userId: 'user-wn4',
      walletId: 'wallet-wn4',
      fiatAmount: '5000',
      processingFee: '100',
      cryptoAmount: '4.9',
      asset: USDC,
      fiatCurrency: 'NGN',
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    const usdcEntries = entries.filter((e) => e.currency === USDC);
    const usdtEntries = entries.filter((e) => e.currency === 'USDT');

    // Two crypto legs (user_wallet + treasury_reserve) must use USDC
    expect(usdcEntries).toHaveLength(2);
    // No USDT entries must exist
    expect(usdtEntries).toHaveLength(0);
    // Per-currency sums are zero
    expect(sumByCurrency(entries, USDC)).toBe(0n);
    expect(sumByCurrency(entries, 'NGN')).toBe(0n);
  });

  it('USDT path still works (backward compat) when asset=USDT', () => {
    const entries = buildBuyLedgerEntries({
      userId: 'user-wn4-usdt',
      walletId: 'wallet-wn4-usdt',
      fiatAmount: '5000',
      processingFee: '100',
      cryptoAmount: '3.06',
      asset: 'USDT',
      fiatCurrency: 'NGN',
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    const usdtEntries = entries.filter((e) => e.currency === 'USDT');
    expect(usdtEntries).toHaveLength(2);
    expect(sumByCurrency(entries, 'USDT')).toBe(0n);
  });
});

describe('WN-4: buildDepositLedgerEntries — non-USDT asset (USDC)', () => {
  it('both ledger legs keyed by USDC, not USDT', () => {
    const entries = buildDepositLedgerEntries({
      walletId: 'wallet-deposit-wn4',
      cryptoAmount: '5.0',
      asset: USDC,
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    const usdcEntries = entries.filter((e) => e.currency === USDC);
    const usdtEntries = entries.filter((e) => e.currency === 'USDT');

    expect(usdcEntries).toHaveLength(2);
    expect(usdtEntries).toHaveLength(0);
    expect(sumByCurrency(entries, USDC)).toBe(0n);
  });
});

describe('WN-4: buildSellReserveEntries — non-USDT asset (USDC)', () => {
  it('both reserve legs keyed by USDC', () => {
    const entries = buildSellReserveEntries({
      walletId: 'wallet-sell-wn4',
      cryptoAmount: '3.0',
      asset: USDC,
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    const usdcEntries = entries.filter((e) => e.currency === USDC);
    expect(usdcEntries).toHaveLength(2);
    expect(entries.filter((e) => e.currency === 'USDT')).toHaveLength(0);
    expect(sumByCurrency(entries, USDC)).toBe(0n);
  });
});

describe('WN-4: buildSellFinalizeEntries — non-USDT asset (USDC)', () => {
  it('USDC legs keyed by USDC; NGN legs still NGN', () => {
    const entries = buildSellFinalizeEntries({
      walletId: 'wallet-finalize-wn4',
      cryptoAmount: '3.0',
      netFiatAmount: '7500',
      asset: USDC,
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    expect(entries.filter((e) => e.currency === USDC)).toHaveLength(2);
    expect(entries.filter((e) => e.currency === 'NGN')).toHaveLength(2);
    expect(entries.filter((e) => e.currency === 'USDT')).toHaveLength(0);
    expect(sumByCurrency(entries, USDC)).toBe(0n);
    expect(sumByCurrency(entries, 'NGN')).toBe(0n);
  });
});

describe('WN-4: buildSellRefundEntries — non-USDT asset (USDC)', () => {
  it('refund legs keyed by USDC', () => {
    const entries = buildSellRefundEntries({
      walletId: 'wallet-refund-wn4',
      cryptoAmount: '3.0',
      asset: USDC,
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    expect(entries.filter((e) => e.currency === USDC)).toHaveLength(2);
    expect(entries.filter((e) => e.currency === 'USDT')).toHaveLength(0);
    expect(sumByCurrency(entries, USDC)).toBe(0n);
  });
});

describe('WN-4: buildSendReserveEntries — non-USDT asset (USDC)', () => {
  it('send reserve legs keyed by USDC', () => {
    const entries = buildSendReserveEntries({
      walletId: 'wallet-send-wn4',
      totalDebit: '11.0',
      asset: USDC,
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    expect(entries.filter((e) => e.currency === USDC)).toHaveLength(2);
    expect(entries.filter((e) => e.currency === 'USDT')).toHaveLength(0);
    expect(sumByCurrency(entries, USDC)).toBe(0n);
  });
});

describe('WN-4: buildSendFinalizeEntries — non-USDT asset (USDC)', () => {
  it('all 3 finalize legs keyed by USDC', () => {
    const entries = buildSendFinalizeEntries({
      walletId: 'wallet-send-fin-wn4',
      cryptoAmount: '10.0',
      networkFeeCrypto: '1.0',
      asset: USDC,
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    expect(entries.filter((e) => e.currency === USDC)).toHaveLength(3);
    expect(entries.filter((e) => e.currency === 'USDT')).toHaveLength(0);
    expect(sumByCurrency(entries, USDC)).toBe(0n);
  });
});

describe('WN-4: buildSendRefundEntries — non-USDT asset (USDC)', () => {
  it('send refund legs keyed by USDC', () => {
    const entries = buildSendRefundEntries({
      walletId: 'wallet-send-refund-wn4',
      totalDebit: '11.0',
      asset: USDC,
      postedAt: new Date('2025-01-01T00:00:00Z'),
      accountStates: {},
    });

    expect(entries.filter((e) => e.currency === USDC)).toHaveLength(2);
    expect(entries.filter((e) => e.currency === 'USDT')).toHaveLength(0);
    expect(sumByCurrency(entries, USDC)).toBe(0n);
  });
});
