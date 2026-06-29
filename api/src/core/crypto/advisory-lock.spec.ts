/**
 * Unit tests for advisory-lock.ts
 *
 * Verifies:
 *   - acquireAccountAdvisoryLock calls pg_advisory_xact_lock with a stable bigint.
 *   - Different (accountType, accountId) pairs produce different keys.
 *   - Same pair always produces the same key (deterministic).
 *   - acquireAccountAdvisoryLocks acquires in sorted key order (deadlock prevention).
 */

import {
  acquireAccountAdvisoryLock,
  acquireAccountAdvisoryLocks,
} from './advisory-lock';

// ---------------------------------------------------------------------------
// Mock Prisma transaction client
// ---------------------------------------------------------------------------

function makeMockTx() {
  const calls: string[] = [];
  const tx = {
    // pg_advisory_xact_lock returns void — use $executeRawUnsafe (no result).
    $executeRawUnsafe: jest.fn().mockImplementation((sql: string) => {
      calls.push(sql);
      return Promise.resolve(0);
    }),
  };
  return { tx, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('acquireAccountAdvisoryLock', () => {
  it('calls pg_advisory_xact_lock with a bigint literal for the account key', async () => {
    const { tx, calls } = makeMockTx();

    await acquireAccountAdvisoryLock(
      tx as never,
      'user_wallet',
      'wallet-id-abc',
    );

    expect(calls).toHaveLength(1);
    // Must call pg_advisory_xact_lock with a numeric bigint (no quotes around the number).
    expect(calls[0]).toMatch(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/);
  });

  it('produces the same key for the same (accountType, accountId) — deterministic', async () => {
    const { tx: tx1, calls: calls1 } = makeMockTx();
    const { tx: tx2, calls: calls2 } = makeMockTx();

    await acquireAccountAdvisoryLock(
      tx1 as never,
      'user_wallet',
      'wallet-id-xyz',
    );
    await acquireAccountAdvisoryLock(
      tx2 as never,
      'user_wallet',
      'wallet-id-xyz',
    );

    expect(calls1[0]).toBe(calls2[0]);
  });

  it('produces different keys for different accountId values', async () => {
    const { tx: tx1, calls: calls1 } = makeMockTx();
    const { tx: tx2, calls: calls2 } = makeMockTx();

    await acquireAccountAdvisoryLock(
      tx1 as never,
      'user_wallet',
      'wallet-id-A',
    );
    await acquireAccountAdvisoryLock(
      tx2 as never,
      'user_wallet',
      'wallet-id-B',
    );

    expect(calls1[0]).not.toBe(calls2[0]);
  });

  it('produces different keys for same accountId but different accountType', async () => {
    const { tx: tx1, calls: calls1 } = makeMockTx();
    const { tx: tx2, calls: calls2 } = makeMockTx();

    await acquireAccountAdvisoryLock(tx1 as never, 'user_wallet', 'shared-id');
    await acquireAccountAdvisoryLock(tx2 as never, 'clearing', 'shared-id');

    expect(calls1[0]).not.toBe(calls2[0]);
  });

  it('produced key fits in signed int64 range', async () => {
    const { tx, calls } = makeMockTx();

    await acquireAccountAdvisoryLock(
      tx as never,
      'clearing',
      'usdt_sell_clearing',
    );

    const match = calls[0].match(/\((-?\d+)\)/);
    expect(match).not.toBeNull();
    const key = BigInt(match![1]);
    // Postgres bigint: signed 64-bit, range [-2^63, 2^63-1].
    expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(key).toBeLessThanOrEqual(2n ** 63n - 1n);
  });
});

describe('acquireAccountAdvisoryLocks', () => {
  it('acquires locks for all accounts in the list', async () => {
    const { tx, calls } = makeMockTx();

    await acquireAccountAdvisoryLocks(tx as never, [
      { accountType: 'user_wallet', accountId: 'wallet-1' },
      { accountType: 'clearing', accountId: 'usdt_sell_clearing' },
    ]);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatch(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/);
    }
  });

  it('acquires locks in a consistent sorted order regardless of input order', async () => {
    const { tx: txA, calls: callsA } = makeMockTx();
    const { tx: txB, calls: callsB } = makeMockTx();

    const accounts = [
      { accountType: 'user_wallet', accountId: 'wallet-1' },
      { accountType: 'clearing', accountId: 'usdt_sell_clearing' },
      { accountType: 'treasury_reserve', accountId: 'usdt_treasury' },
    ];

    // Order A: forward.
    await acquireAccountAdvisoryLocks(txA as never, accounts);
    // Order B: reversed.
    await acquireAccountAdvisoryLocks(txB as never, [...accounts].reverse());

    // The calls must be in the same order in both cases.
    expect(callsA).toEqual(callsB);
  });

  it('no-ops gracefully for an empty list', async () => {
    const { tx, calls } = makeMockTx();

    await acquireAccountAdvisoryLocks(tx as never, []);

    expect(calls).toHaveLength(0);
  });
});
