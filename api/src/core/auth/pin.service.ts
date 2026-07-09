/**
 * Transaction-PIN service (task 4.3, CLAUDE.md §3.4 / §4.1).
 *
 * Hashes PINs with **argon2id** (the same KDF the admin-password path uses) and
 * enforces a failure-counting lockout. The service is the ONLY code that
 * touches raw PINs; all callers receive resolved or rejected Promises.
 *
 * Self-describing hash format (audit R4): a stored `pinHash` is either the
 * argon2id encoded string (`$argon2id$…`) or a legacy scrypt `<saltHex>:<hashHex>`
 * from before the migration. `verifyPin` detects the format and, on a successful
 * legacy-scrypt verify, transparently re-hashes to argon2id and persists it —
 * opportunistic migration within the existing flow, no separate migration job.
 *
 * Security invariants:
 *   - argon2id verification is constant-time; legacy scrypt comparison uses
 *     `crypto.timingSafeEqual` to prevent timing attacks.
 *   - argon2 embeds a fresh random salt + parameters in every hash.
 *   - PINs are never logged.
 *   - Config is read from ConfigService — nothing is hardcoded (root §7).
 */

import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

import { TransactionPinSchema } from '@handshake-agent/contracts';

import { CLOCK, type Clock } from '../common/clock';
import {
  PinInvalidError,
  PinLockedError,
  PinNotSetError,
  WeakPinError,
} from './domain/pin-errors';
import {
  PIN_REPOSITORY,
  type IPinRepository,
} from './ports/pin.repository.port';

const scryptAsync = promisify(scrypt);

/**
 * argon2id parameters for PIN hashing. Deliberately identical to the admin
 * password hasher (`Argon2PasswordHasher`) — `{ type: argon2.argon2id }` with
 * argon2's vetted default cost (t=3, m=64 MiB, p=4) — so both credential paths
 * share one KDF policy. If those defaults ever need tuning, tune them in both.
 */
const ARGON2_OPTIONS: argon2.Options = { type: argon2.argon2id };

/** argon2 encoded hashes are self-describing and begin with this prefix. */
const ARGON2_PREFIX = '$argon2';

@Injectable()
export class PinService {
  private readonly maxAttempts: number;
  private readonly lockoutMs: number;
  private readonly scryptKeyLen: number;

  constructor(
    @Inject(PIN_REPOSITORY) private readonly pinRepo: IPinRepository,
    private readonly config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.maxAttempts = this.config.get<number>('auth.pin.maxAttempts') ?? 5;
    this.lockoutMs =
      (this.config.get<number>('auth.pin.lockoutMinutes') ?? 15) * 60 * 1000;
    this.scryptKeyLen = this.config.get<number>('auth.pin.scryptKeyLen') ?? 64;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Hashes a raw PIN using argon2id with a fresh embedded salt.
   * Returns the self-describing `$argon2id$…` encoded string for `pinHash`.
   *
   * Server-side strength gate (CLAUDE.md §3.3): the PIN must satisfy the shared
   * `TransactionPinSchema` (4–6 digits, not all-same, not a trivial sequence).
   * This is the security boundary — a weak PIN is rejected here even if a
   * non-web caller bypasses the client form. The schema is the single canonical
   * rule shared with the frontend.
   */
  async hashPin(pin: string): Promise<string> {
    if (!TransactionPinSchema.safeParse(pin).success) {
      throw new WeakPinError();
    }
    return argon2.hash(pin, ARGON2_OPTIONS);
  }

  /**
   * Reports whether `userId` already has a transaction PIN set. Used to gate
   * the set-PIN-for-verified-user flow (a PIN may only be set when none exists;
   * replacing an existing PIN requires step-up, not this path).
   */
  async hasPin(userId: string): Promise<boolean> {
    const state = await this.pinRepo.getPinState(userId);
    return state !== null && state.pinHash !== null;
  }

  /**
   * Sets (or resets) the PIN for `userId`. Hashes the raw PIN and persists
   * the result via the repository, then clears any existing failure state.
   */
  async setPin(userId: string, pin: string): Promise<void> {
    const hash = await this.hashPin(pin);
    await this.pinRepo.setPinHash(userId, hash);
    await this.pinRepo.resetFailures(userId);
  }

  /**
   * Verifies the supplied raw PIN against the stored hash.
   *
   * Throws:
   *   - `PinNotSetError`  — no user record, or `pinHash` is null.
   *   - `PinLockedError`  — `pinLockedUntil` is in the future, OR a concurrent
   *      burst pushed the failure count past `maxAttempts` before this call
   *      could compare (see below).
   *   - `PinInvalidError` — PIN does not match (failure recorded).
   *
   * On success: if there were prior failures, they are reset. Returns void.
   *
   * TOCTOU brute-force guard (CLAUDE.md §3.4): the failure counter is
   * incremented ATOMICALLY at the DB *before* the scrypt comparison. Because
   * one valid directive+nonce authorizes the PIN check, a stolen session could
   * otherwise fire many concurrent guesses that all read the same stale count
   * and never advance the lockout. Incrementing first means at most
   * `maxAttempts` concurrent calls ever reach the constant-time comparison; the
   * rest are short-circuited to `PinLockedError`, and the account ends locked.
   */
  async verifyPin(userId: string, pin: string): Promise<void> {
    const state = await this.pinRepo.getPinState(userId);

    // a. No state or no hash → PIN not set.
    if (!state || state.pinHash === null) {
      throw new PinNotSetError();
    }

    const now = this.clock.now();

    // b. Still within an active lockout window → reject, no increment, no compare.
    if (state.pinLockedUntil && state.pinLockedUntil > now) {
      throw new PinLockedError(state.pinLockedUntil);
    }

    // c. Register this attempt ATOMICALLY. One DB statement either starts a fresh
    //    window (when the prior lock has expired) or increments the counter —
    //    never a separate reset-THEN-increment, which a concurrent burst on a
    //    just-expired lock could interleave to keep every guess under the cap
    //    (the TOCTOU brute-force bypass, CLAUDE.md §3.4). Runs BEFORE the scrypt
    //    compare so at most `maxAttempts` concurrent calls ever reach it.
    const { count: newCount, lockedUntil } =
      await this.pinRepo.registerFailedAttempt(userId, now);

    // d. A concurrent racer set an active lock between our read and this write →
    //    reject without comparing (the atomic statement left the count untouched).
    if (lockedUntil && lockedUntil > now) {
      throw new PinLockedError(lockedUntil);
    }

    // e. Burst overflow: this call's atomic count raced past the threshold. Lock
    //    and reject WITHOUT running scrypt — this is what caps concurrent
    //    comparisons at maxAttempts.
    if (newCount > this.maxAttempts) {
      const until = new Date(now.getTime() + this.lockoutMs);
      await this.pinRepo.setLock(userId, until);
      throw new PinLockedError(until);
    }

    // f. Compare against the stored hash with the algorithm its format names:
    //    argon2id hashes are the self-describing `$argon2id$…` string; anything
    //    else is a legacy scrypt `<saltHex>:<hashHex>` (audit R4). Both verifies
    //    are constant-time.
    const isLegacyScrypt = !state.pinHash.startsWith(ARGON2_PREFIX);
    const match = isLegacyScrypt
      ? await this.verifyScrypt(pin, state.pinHash)
      : await this.verifyArgon2(pin, state.pinHash);

    // g. Match — opportunistically migrate a legacy scrypt hash to argon2id
    //    in-flight (persist the upgraded credential), then clear the failure
    //    state and return.
    if (match) {
      if (isLegacyScrypt) {
        await this.pinRepo.setPinHash(
          userId,
          await argon2.hash(pin, ARGON2_OPTIONS),
        );
      }
      await this.pinRepo.resetFailures(userId);
      return;
    }

    // h. Mismatch — the atomic register already advanced the counter. If that
    //    reached maxAttempts, persist the lock now.
    if (newCount >= this.maxAttempts) {
      const lockedUntil = new Date(now.getTime() + this.lockoutMs);
      await this.pinRepo.setLock(userId, lockedUntil);
    }

    const remaining = Math.max(this.maxAttempts - newCount, 0);
    throw new PinInvalidError(remaining);
  }

  // ---------------------------------------------------------------------------
  // KDF verification (private)
  // ---------------------------------------------------------------------------

  /**
   * Constant-time verify of a legacy scrypt `<saltHex>:<hashHex>` PIN hash.
   * Re-derives with the stored salt at the configured key length and compares
   * via `timingSafeEqual`. Retained only to verify (and then migrate) rows that
   * predate the argon2id cut-over — new hashes are never written in this format.
   */
  private async verifyScrypt(
    pin: string,
    storedPinHash: string,
  ): Promise<boolean> {
    const [saltHex, storedHashHex] = storedPinHash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const storedHash = Buffer.from(storedHashHex, 'hex');

    const candidateHash = (await scryptAsync(
      pin,
      salt,
      this.scryptKeyLen,
    )) as Buffer;

    return (
      candidateHash.length === storedHash.length &&
      timingSafeEqual(candidateHash, storedHash)
    );
  }

  /**
   * argon2id verify. A malformed or unrecognized encoded hash makes argon2
   * throw; treat that as a failed verification rather than propagating the error
   * (mirrors the admin `Argon2PasswordHasher`).
   */
  private async verifyArgon2(
    pin: string,
    storedPinHash: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(storedPinHash, pin);
    } catch {
      return false;
    }
  }
}
