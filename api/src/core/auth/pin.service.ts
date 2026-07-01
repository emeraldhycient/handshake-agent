/**
 * Transaction-PIN service (task 4.3, CLAUDE.md §3.4 / §4.1).
 *
 * Hashes PINs with Node `crypto.scrypt` (a strong KDF) and enforces a
 * failure-counting lockout. The service is the ONLY code that touches raw
 * PINs; all callers receive resolved or rejected Promises.
 *
 * TODO(SEC): migrate to argon2id for production (currently using Node
 * crypto.scrypt as a valid interim KDF with comparable security properties).
 *
 * Security invariants:
 *   - Comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
 *   - Salt is random 16 bytes per hash (never reused).
 *   - PINs are never logged.
 *   - Config is read from ConfigService — nothing is hardcoded (root §7).
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

const SALT_BYTES = 16;

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
   * Hashes a raw PIN using scrypt with a fresh random salt.
   * Returns a `<saltHex>:<hashHex>` string suitable for storing in `pinHash`.
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
    const salt = randomBytes(SALT_BYTES);
    const hash = (await scryptAsync(pin, salt, this.scryptKeyLen)) as Buffer;
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
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
   *   - `PinLockedError`  — `pinLockedUntil` is in the future.
   *   - `PinInvalidError` — PIN does not match (failure recorded).
   *
   * On success: if there were prior failures, they are reset. Returns void.
   */
  async verifyPin(userId: string, pin: string): Promise<void> {
    const state = await this.pinRepo.getPinState(userId);

    // 1. No state or no hash → PIN not set.
    if (!state || state.pinHash === null) {
      throw new PinNotSetError();
    }

    // 2. Account locked?
    if (state.pinLockedUntil && state.pinLockedUntil > this.clock.now()) {
      throw new PinLockedError(state.pinLockedUntil);
    }

    // 3. Re-derive the hash with the stored salt and compare (constant-time).
    const [saltHex, storedHashHex] = state.pinHash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const storedHash = Buffer.from(storedHashHex, 'hex');

    const candidateHash = (await scryptAsync(
      pin,
      salt,
      this.scryptKeyLen,
    )) as Buffer;

    const match =
      candidateHash.length === storedHash.length &&
      timingSafeEqual(candidateHash, storedHash);

    if (!match) {
      // 4. Mismatch — increment failure count.
      const newCount = state.pinFailureCount + 1;
      const lockedUntil =
        newCount >= this.maxAttempts
          ? new Date(this.clock.now().getTime() + this.lockoutMs)
          : null;

      await this.pinRepo.recordFailure(userId, newCount, lockedUntil);

      const remaining = Math.max(this.maxAttempts - newCount, 0);
      throw new PinInvalidError(remaining);
    }

    // 5. Match — clear prior failures if any.
    if (state.pinFailureCount > 0) {
      await this.pinRepo.resetFailures(userId);
    }
  }
}
