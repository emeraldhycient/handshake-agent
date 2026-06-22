import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../../core/common/clock';
import type {
  AppConfig,
  LimitsConfig,
  TierLimits,
} from '../../../core/config/configuration';
import {
  KycNotVerifiedError,
  SimSwapBlockedError,
  TierLimitExceededError,
  VelocityExceededError,
} from '../domain/gate-errors';
import type { IIdentityRepository } from './ports/identity.repository.port';
import { IDENTITY_REPOSITORY } from './ports/identity.repository.port';
import type { IVelocityRepository } from './ports/velocity.repository.port';
import { VELOCITY_REPOSITORY } from './ports/velocity.repository.port';

/** Valid KYC tier keys that have limit entries. `unverified` is excluded — it is blocked before this helper is called. */
type VerifiedTier = 'tier_1' | 'tier_2' | 'tier_3';

/**
 * Narrows a raw `kycTier` string to one of the three verified tier keys and
 * returns the corresponding limit config. TypeScript verifies the union; the
 * runtime guard is the previous `kycTier === 'unverified'` block.
 *
 * Throws if an unexpected value somehow slips through — defensive, not reachable
 * under correct schema constraints.
 */
function getTierLimits(tier: string, limits: LimitsConfig): TierLimits {
  const verifiedTiers: VerifiedTier[] = ['tier_1', 'tier_2', 'tier_3'];
  if ((verifiedTiers as string[]).includes(tier)) {
    return limits[tier as VerifiedTier];
  }
  // Unreachable in practice: `unverified` is blocked above; schema enforces the enum.
  throw new Error(`Unexpected kycTier value after verification gate: ${tier}`);
}

export interface AssertCanTransactInput {
  userId: string;
  fiatAmount: number;
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
   * Asserts the user is allowed to transact the given fiat amount.
   * Resolves (void) on success; throws a `GateError` subclass on any failure.
   */
  async assertCanTransact(input: AssertCanTransactInput): Promise<void> {
    const { userId, fiatAmount } = input;

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
    // getTierLimits narrows kycTier to the verified-tier union; TypeScript can
    // verify the set rather than relying on a raw `as` cast.
    const limits = this.config.get<LimitsConfig>('limits');
    const tierLimits: TierLimits = getTierLimits(user.kycTier, limits);

    // 4. Per-transaction amount check.
    if (fiatAmount > tierLimits.perTxFiatMax) {
      throw new TierLimitExceededError(
        fiatAmount,
        tierLimits.perTxFiatMax,
        user.kycTier,
      );
    }

    // 5. Velocity checks — load rolling 24-h usage.
    const asOf = this.clock.now();
    const usage = await this.velocityRepo.getDailyUsage(userId, asOf);

    if (usage.fiatTotal + fiatAmount > tierLimits.dailyFiatMax) {
      throw new VelocityExceededError(
        'fiat',
        usage.fiatTotal + fiatAmount,
        tierLimits.dailyFiatMax,
        user.kycTier,
      );
    }

    if (usage.txCount + 1 > tierLimits.dailyTxCountMax) {
      throw new VelocityExceededError(
        'count',
        usage.txCount + 1,
        tierLimits.dailyTxCountMax,
        user.kycTier,
      );
    }
  }
}
