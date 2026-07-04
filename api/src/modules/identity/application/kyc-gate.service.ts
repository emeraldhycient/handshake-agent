import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  ComplianceConfig,
  FiatLimits,
  LimitsConfig,
  TierLimits,
} from '../../../core/config/configuration';
import {
  KycNotVerifiedError,
  OnChainSendLimitExceededError,
  SimSwapBlockedError,
  TierChangeCoolingOffError,
  TierLimitExceededError,
  VelocityExceededError,
} from '../domain/gate-errors';
import { toScaled } from '../../transactions/domain/ledger';
import type {
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
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
  /**
   * True when this is an on-chain (crypto-address) send. On-chain sends are irreversible,
   * so they get an ADDITIONAL single-send cap (`perSendOnChainFiatMax`) beyond the general
   * per-transaction cap. Absent/false for buys, sells, swaps, and fiat payouts.
   */
  onChainSend?: boolean;
}

/**
 * Server-side KYC / velocity / limit gate (§3.3, IDN-12).
 *
 * Every money-moving operation MUST call `assertCanTransact` before execution.
 * The deterministic engine (Phase 4) calls this again at settle time — the
 * frontend gate is UX-only, this is the security gate.
 *
 * Checks (in order — first failing check throws, remaining are skipped):
 *   1.  SIM-swap block (high-severity; blocks regardless of KYC state)
 *   2.  KYC status must be `verified` AND tier must not be `unverified`
 *   2b. Tier-change cooling-off hold (compliance.tierChangeCoolingOffSeconds)
 *   3.  Positive-amount guard + per-transaction fiat amount ≤ tier limit
 *   4c. Single on-chain send cap (perSendOnChainFiatMax; on-chain sends only)
 *   5.  Rolling 24-h fiat total ≤ dailyFiatMax and 24-h tx count + 1 ≤ dailyTxCountMax
 *   6.  Rolling 7-day fiat total ≤ weeklyFiatMax
 *   7.  Rolling 10-min on-chain send count + 1 ≤ sendsPer10MinMax (on-chain sends only)
 *
 * Each cap enforced only when configured (§3.6); the shipped defaults set them all.
 * Tier limits are tunable via EffectiveConfigService / AppSetting (root CLAUDE.md §7):
 * an admin override flows through the same `get('limits')` call site at runtime.
 */
@Injectable()
export class KycGateService {
  constructor(
    @Inject(IDENTITY_REPOSITORY)
    private readonly identityRepo: IIdentityRepository,
    @Inject(VELOCITY_REPOSITORY)
    private readonly velocityRepo: IVelocityRepository,
    private readonly config: EffectiveConfigService,
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

    // Steps 1–4b (SIM-swap / KYC status+tier / tier-change cooling-off / positive +
    // per-tx cap) are shared with assertCanReleasePayout via assertBaselineEligibility.
    const { user, tierLimits, scaledTxAmount } =
      await this.assertBaselineEligibility({
        userId,
        fiatAmount,
        fiatCurrency,
      });

    // 4c. Single on-chain send cap — an ADDITIONAL per-send limit applied ONLY to
    // on-chain (crypto-address) sends, which are irreversible (§3.6: enforce the cap
    // where it exists; the shipped defaults always set it). Never gates buy/sell/swap.
    if (input.onChainSend && tierLimits.perSendOnChainFiatMax !== undefined) {
      const scaledSendMax = toScaled(String(tierLimits.perSendOnChainFiatMax));
      if (scaledTxAmount > scaledSendMax) {
        throw new OnChainSendLimitExceededError(
          Number(fiatAmount),
          tierLimits.perSendOnChainFiatMax,
          user.kycTier,
          fiatCurrency,
        );
      }
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

    // 6. Rolling 7-day (weekly) fiat velocity — enforced only when the tier carries a
    // weekly cap (the shipped defaults always do; §3.6: enforce the cap that exists,
    // never a cap that doesn't). Same BigInt-scaled comparison as the daily check.
    if (tierLimits.weeklyFiatMax !== undefined) {
      const weekly = await this.velocityRepo.getWeeklyUsage(
        userId,
        asOf,
        fiatCurrency,
      );
      const scaledWeeklyUsed = toScaled(weekly.fiatTotal);
      const scaledWeeklyMax = toScaled(String(tierLimits.weeklyFiatMax));
      if (scaledWeeklyUsed + scaledTxAmount > scaledWeeklyMax) {
        throw new VelocityExceededError(
          'weekly',
          Number(weekly.fiatTotal) + Number(fiatAmount),
          tierLimits.weeklyFiatMax,
          user.kycTier,
          fiatCurrency,
        );
      }
    }

    // 7. Rolling 10-minute on-chain SEND-count velocity — an anti-rapid-fire cap for
    // on-chain (irreversible) sends only (§3.6: enforced only when the tier carries it;
    // the shipped defaults always do). Counts this send toward the window (+1).
    if (input.onChainSend && tierLimits.sendsPer10MinMax !== undefined) {
      const recentSends = await this.velocityRepo.getRecentSendCount(
        userId,
        asOf,
        TEN_MINUTES_MS,
      );
      if (recentSends + 1 > tierLimits.sendsPer10MinMax) {
        throw new VelocityExceededError(
          'sends_10min',
          recentSends + 1,
          tierLimits.sendsPer10MinMax,
          user.kycTier,
          fiatCurrency,
        );
      }
    }
  }

  /**
   * Baseline money-gate eligibility shared by `assertCanTransact` and
   * `assertCanReleasePayout`: SIM-swap block, KYC status + tier, tier-change
   * cooling-off, and the positive-amount + per-transaction cap (steps 1–4b).
   * Returns the loaded user, resolved tier limits, and the BigInt-scaled tx amount
   * so `assertCanTransact` can continue with the cumulative velocity checks. Throws
   * a `GateError` subclass on the first failing check.
   */
  private async assertBaselineEligibility(input: {
    userId: string;
    fiatAmount: string;
    fiatCurrency: string;
  }): Promise<{
    user: UserRecord;
    tierLimits: TierLimits;
    scaledTxAmount: bigint;
  }> {
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

    // 2b. Tier-change cooling-off — a time-based hold on ALL money moves within
    // `compliance.tierChangeCoolingOffSeconds` of the last tier change (§3.3, anti-abuse
    // after a fresh tier grant). 0 (default) or a null tierChangedAt = no hold.
    const coolingOffSeconds =
      this.config.get<ComplianceConfig>(
        'compliance',
      )?.tierChangeCoolingOffSeconds;
    if (
      coolingOffSeconds !== undefined &&
      coolingOffSeconds > 0 &&
      user.tierChangedAt !== null
    ) {
      const holdUntil = new Date(
        user.tierChangedAt.getTime() + coolingOffSeconds * 1000,
      );
      if (this.clock.now() < holdUntil) {
        throw new TierChangeCoolingOffError(holdUntil, user.kycTier);
      }
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

    return { user, tierLimits, scaledTxAmount };
  }

  /**
   * Re-check gate for RETRYING a payout whose reserve + velocity were ALREADY
   * consumed at execute time. Runs the baseline (SIM-swap / KYC / tier /
   * cooling-off / per-tx cap) but intentionally OMITS the cumulative daily/weekly
   * velocity + 10-min send caps — re-adding this tx's amount would double-count and
   * falsely block a legitimate retry (§3.3). Resolves (void) on success; throws a
   * `GateError` subclass on failure. `asset` is accepted for call-site symmetry with
   * `assertCanTransact`; it does not affect the fiat gate.
   */
  async assertCanReleasePayout(input: {
    userId: string;
    fiatAmount: string;
    fiatCurrency: string;
    asset: string;
  }): Promise<void> {
    await this.assertBaselineEligibility({
      userId: input.userId,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
    });
  }
}

/** Rolling window for the on-chain send-count velocity cap. */
const TEN_MINUTES_MS = 10 * 60 * 1000;
