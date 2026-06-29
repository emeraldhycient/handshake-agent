/**
 * Postgres per-account advisory lock helper for ledger sequence allocation.
 *
 * The ledger unique constraint is (accountType, accountId, sequence).
 * Two concurrent transactions for the SAME (accountType, accountId) can both
 * read the same max(sequence) inside their respective serializable transactions,
 * compute the same next sequence number, and race to insert — causing P2002.
 *
 * Fix: take a transaction-scoped advisory lock keyed by a stable bigint hash
 * of (accountType, accountId) at the START of each settlement transaction —
 * BEFORE any ledger reads or writes. Concurrent settlements for the same
 * account serialize. The lock auto-releases when the transaction commits or
 * rolls back (pg_advisory_xact_lock semantics).
 *
 * Usage (inside a Prisma $transaction callback):
 *   await acquireAccountAdvisoryLock(tx, 'user_wallet', walletId);
 *   // now safe to read max(sequence) and insert new rows
 *
 * Key derivation: FNV-1a over UTF-8 bytes of `${accountType}:${accountId}`,
 * folded into the signed 64-bit Postgres bigint range via modular arithmetic.
 * FNV-1a is deterministic, fast, and has no external dependencies.
 */

import type { Prisma } from '../../../generated/prisma/client';

// ---------------------------------------------------------------------------
// FNV-1a 64-bit (approximated in BigInt)
// ---------------------------------------------------------------------------

const FNV_OFFSET_64 = 14695981039346656037n;
const FNV_PRIME_64 = 1099511628211n;
// Modulus: wrap to uint64 range (2^64).
const MOD_64 = 2n ** 64n;
// Postgres bigint is SIGNED int64 — max positive value.
const MAX_INT64 = 9223372036854775807n;

/**
 * Computes FNV-1a 64-bit hash of the input string, returned as a Postgres-safe
 * signed bigint. Collisions are astronomically unlikely for the small, fixed set
 * of (accountType, accountId) tuples in this system.
 */
function fnv1a64(input: string): bigint {
  const bytes = Buffer.from(input, 'utf8');
  let hash = FNV_OFFSET_64;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) % MOD_64;
  }
  // Map unsigned uint64 into signed int64 range.
  // If hash > MAX_INT64, shift into negative half: hash - 2^64.
  return hash > MAX_INT64 ? hash - MOD_64 : hash;
}

// ---------------------------------------------------------------------------
// Advisory lock acquisition
// ---------------------------------------------------------------------------

/**
 * Takes a Postgres transaction-scoped advisory lock for the given account.
 *
 * Must be called at the START of every settlement $transaction that allocates
 * ledger sequence numbers for (accountType, accountId). Multiple calls for
 * different accounts within the same transaction are additive — each obtains
 * its own lock. Locks are automatically released when the surrounding
 * $transaction commits or rolls back.
 *
 * @param tx   - The Prisma interactive transaction client.
 * @param accountType - e.g. 'user_wallet', 'clearing'.
 * @param accountId   - e.g. walletId, 'usdt_sell_clearing'.
 */
export async function acquireAccountAdvisoryLock(
  tx: Prisma.TransactionClient,
  accountType: string,
  accountId: string,
): Promise<void> {
  const key = fnv1a64(`${accountType}:${accountId}`);
  // pg_advisory_xact_lock returns void, which Prisma 7 $queryRawUnsafe cannot
  // deserialize. Use $executeRawUnsafe (no result expected) instead.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key})`);
}

/**
 * Acquires advisory locks for ALL accounts in the given list, in key-sorted
 * order to prevent deadlocks when two concurrent transactions lock the same set
 * in different order.
 *
 * Use this variant when a single settlement touches more than one account
 * (e.g. buy: user_wallet + processor_settlement + treasury_reserve + platform_float).
 *
 * @param tx       - Prisma interactive transaction client.
 * @param accounts - List of (accountType, accountId) pairs to lock.
 */
export async function acquireAccountAdvisoryLocks(
  tx: Prisma.TransactionClient,
  accounts: ReadonlyArray<{ accountType: string; accountId: string }>,
): Promise<void> {
  // Sort by key to guarantee a consistent global locking order, preventing deadlocks.
  const sorted = [...accounts].sort((a, b) => {
    const ka = fnv1a64(`${a.accountType}:${a.accountId}`);
    const kb = fnv1a64(`${b.accountType}:${b.accountId}`);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  for (const account of sorted) {
    await acquireAccountAdvisoryLock(
      tx,
      account.accountType,
      account.accountId,
    );
  }
}
