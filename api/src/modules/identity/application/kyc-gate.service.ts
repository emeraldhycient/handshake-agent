import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../../core/common/clock';
import type {
  AppConfig,
  FiatLimits,
  LimitsConfig,
  TierLimits,
} from '../../../core/config/configuration';
import {
  KycNotVerifiedError,
  SimSwapBlockedError,
  TierLimitExceededError,
  VelocityExceededError,
} from '../domain/gate-errors';
import { toScaled } from '../../transactions/domain/ledger';
import type { IIdentityRepository } from './ports/identity.repository.port';
import { IDENTITY_REPOSITORY } from './ports/identity.repository.port';
import type { IVelocityRepository } from './ports/velocity.repository.port';
import { VELOCITY_REPOSITORY } from './ports/velocity.repository.port';

/** Valid KYC tier keys that have limit entries. `unverified` is excluded — it is blocked before this helper is called. */
type VerifiedTier = 'tier_1' | 'tier_2' | 'tier_3';

/**
 * Resolves the per-fiat, per-KYC-tier limit for a given transaction currency.
 *
 * Fails closed: if no limits are configured for `fiatCurrency`, throws immediately
 * rather than silently allowing the transaction. This ensures that adding a new
 * fiat currency to the catalog requires an explicit config entry before it can be
 * used in transactions.
 *
 * Narrows a raw `kycTier` string to one of the three verified tier keys;
 * the runtime guard is the previous `kycTier === 'unverified'` block.
 */
function getTierLimits(
  tier: string,
  fiatCurrency: string,
  limits: LimitsConfig,
): TierLimits {
  const fiatLimits: FiatLimits | undefined = limits[fiatCurrency];
  if (!fiatLimits) {
    throw new Error(`KycGate: no limits configured for fiat ${fiatCurrency}`);
  }
  const verifiedTiers: VerifiedTier[] = ['tier_1', 'tier_2', 'tier_3'];
  if ((verifiedTiers as string[]).includes(tier)) {
    return fiatLimits[tier as VerifiedTier];
  }
  // Unreachable in practice: `unverified` is blocked above; schema enforces the enum.
  throw new Error(`Unexpected kycTier value after verification gate: ${tier}`);
}

/**
 * Builds a display name string from KycProfile's firstName and lastName.
 * Returns null when both fields are absent (profile missing or unverified).
 *
 * NOTE: Leading/trailing whitespace is trimmed; a name with only whitespace
 * resolves to null. This mirrors what a regulator expects — a blank string
 * is less useful than a null sentinel indicating "not captured yet".
 */
function buildDisplayName(
  firstName: string | null,
  lastName: string | null,
): string | null {
  const parts = [firstName, lastName]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Originator attribution for the payment provider's customer object: the real
 * KYC name plus a single resolved verified email. Any field may be null when the
 * user has not yet captured it; callers substitute their own safe fallback.
 */
export interface OriginatorIdentity {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface AssertCanTransactInput {
  userId: string;
  /**
   * Exact fiat amount in `fiatCurrency` as a decimal string (e.g. "10000" or "5000.50").
   * String — not `number` — to prevent IEEE-754 float drift at the money boundary
   * (Fix-C: BigInt-exact comparison with toScaled from the ledger domain).
   */
  fiatAmount: string;
  /** ISO fiat currency code for this transaction (e.g. 'NGN'). Used to resolve per-fiat tier limits. */
  fiatCurrency: string;
  asset: string;
}

/**
 * Server-side KYC / velocity / limit gate (§3.3, IDN-12).
 *
 * Every money-moving operation MUST call `assertCanTransact` before execution.
 * The deterministic engine (Phase 4) calls this again at settle time — the
 * frontend gate is UX-only, this is the security gate.
 *
 * Checks (in order — first failing check throws, remaining are skipped):
 *   1. SIM-swap block (high-severity; blocks regardless of KYC state)
 *   2. KYC status must be `verified` AND tier must not be `unverified`
 *   3. Per-transaction fiat amount ≤ tier limit
 *   4. Rolling 24-h fiat total would not exceed daily limit
 *   5. Rolling 24-h tx count + 1 would not exceed daily count limit
 *
 * TODO(config-admin): once the DB-admin AppSetting layer is built, the limits
 * returned by ConfigService should be overridable at runtime without a deploy
 * (root CLAUDE.md §7). The call-site here does not need to change — just add
 * the override layer inside the ConfigService resolution chain.
 */
@Injectable()
export class KycGateService {
  constructor(
    @Inject(IDENTITY_REPOSITORY)
    private readonly identityRepo: IIdentityRepository,
    @Inject(VELOCITY_REPOSITORY)
    private readonly velocityRepo: IVelocityRepository,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  /**
   * Returns the originator display name (firstName + lastName) from the user's
   * KycProfile, or null if the profile does not exist or both name fields are
   * absent.
   *
   * Used exclusively by the execution engine for Travel Rule originator capture
   * (AUD-08, FATF R16).  Resolves null rather than throwing so callers can
   * write a null sentinel and document the gap (TravelRuleData.originatorName
   * schema allows a non-null empty string as the current sentinel; null is the
   * canonical "not yet captured" value passed through the port).
   */
  async getOriginatorName(userId: string): Promise<string | null> {
    const profile = await this.identityRepo.findKycProfile(userId);
    if (profile === null) return null;
    return buildDisplayName(profile.firstName, profile.lastName);
  }

  /**
   * Returns the originator attribution (real KYC firstName/lastName + a single
   * resolved verified email) for the payment provider's customer object on a
   * fiat pay-in, so the virtual-account collection carries correct customer
   * attribution for reconciliation/compliance.
   *
   * Email precedence (business rule): the KYC-captured `verifiedEmail` is the
   * compliance-canonical address, so it wins; the OTP-verified login `email`
   * is the fallback. Resolves all fields to null when the user row is absent so
   * the caller can substitute its own safe placeholders.
   */
  async getOriginatorIdentity(userId: string): Promise<OriginatorIdentity> {
    const record = await this.identityRepo.findOriginatorIdentity(userId);
    if (record === null) {
      return { firstName: null, lastName: null, email: null };
    }
    return {
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.verifiedEmail ?? record.email,
    };
  }

  /**
   * Asserts the user is allowed to transact the given fiat amount.
   * Resolves (void) on success; throws a `GateError` subclass on any failure.
   */
  async assertCanTransact(input: AssertCanTransactInput): Promise<void> {
    const { userId, fiatAmount, fiatCurrency } = input;

    const user = await this.identityRepo.loadUser(userId);
    if (user === null) {
      throw new Error(`User not found: ${userId}`);
    }

    // 1. SIM-swap block — highest severity; checked before KYC.
    if (user.simSwapDetectedAt !== null) {
      throw new SimSwapBlockedError();
    }

    // 2. KYC status + tier gate.
    if (user.kycStatus !== 'verified') {
      throw new KycNotVerifiedError('status');
    }
    if (user.kycTier === 'unverified') {
      throw new KycNotVerifiedError('tier');
    }

    // 3. Resolve tier limits from config (never hardcoded in the service).
    // getTierLimits looks up limits[fiatCurrency] first (fail-closed for unconfigured
    // currencies), then narrows kycTier to the verified-tier union.
    const limits = this.config.get<LimitsConfig>('limits');
    const tierLimits: TierLimits = getTierLimits(
      user.kycTier,
      fiatCurrency,
      limits,
    );

    // Fix-C: all fiat comparisons use BigInt-scaled integers via toScaled() from
    // the ledger domain. This matches the 10^18 scale used by the ledger and avoids
    // IEEE-754 float drift at the money boundary.
    // Config limits are `number` (whole NGN integers from JSON); convert them to
    // their decimal-string form before scaling so toScaled() can parse them.
    const scaledTxAmount = toScaled(fiatAmount);
    const scaledPerTxMax = toScaled(String(tierLimits.perTxFiatMax));

    // 4a. Positive-amount guard — fail closed on a non-positive fiat-equivalent
    // (finding #20). BUY/SELL are protected incidentally by the quote domain,
    // but SEND/SWAP route their fiat-equivalent straight through this gate, so a
    // zero/negative amount would otherwise pass BOTH the tier and velocity checks
    // (and increment the velocity counters with a 0 contribution). The money gate
    // must never pass a non-positive amount regardless of which path called it
    // (§3.1 / §3.3). Reuse TierLimitExceededError so the global filter maps it to
    // a clean 403 (a non-positive amount is not a permitted transaction value);
    // requestedAmount carries the offending value, limitAmount the per-tx cap.
    if (scaledTxAmount <= 0n) {
      throw new TierLimitExceededError(
        Number(fiatAmount),
        tierLimits.perTxFiatMax,
        user.kycTier,
        fiatCurrency,
      );
    }

    // 4b. Per-transaction amount check (BigInt-exact).
    if (scaledTxAmount > scaledPerTxMax) {
      // Expose the original values for the error payload; convert back to numbers
      // via Number() only for the error object (not for the comparison itself).
      throw new TierLimitExceededError(
        Number(fiatAmount),
        tierLimits.perTxFiatMax,
        user.kycTier,
        fiatCurrency,
      );
    }

    // 5. Velocity checks — load rolling 24-h usage, scoped to the transaction's fiat currency.
    const asOf = this.clock.now();
    const usage = await this.velocityRepo.getDailyUsage(
      userId,
      asOf,
      fiatCurrency,
    );

    // DailyUsage.fiatTotal is now a decimal string (Fix-C); scale both before adding.
    const scaledDailyUsed = toScaled(usage.fiatTotal);
    const scaledDailyMax = toScaled(String(tierLimits.dailyFiatMax));
    const scaledDailyAfter = scaledDailyUsed + scaledTxAmount;

    if (scaledDailyAfter > scaledDailyMax) {
      throw new VelocityExceededError(
        'fiat',
        // Error payload stays as numbers for backward-compat with existing error shape.
        Number(usage.fiatTotal) + Number(fiatAmount),
        tierLimits.dailyFiatMax,
        user.kycTier,
        fiatCurrency,
      );
    }

    if (usage.txCount + 1 > tierLimits.dailyTxCountMax) {
      throw new VelocityExceededError(
        'count',
        usage.txCount + 1,
        tierLimits.dailyTxCountMax,
        user.kycTier,
        fiatCurrency,
      );
    }
  }
}
