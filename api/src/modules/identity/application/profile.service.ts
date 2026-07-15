import { Inject, Injectable } from '@nestjs/common';

import type {
  MembershipSecurity,
  ProfileResponse,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { LimitsConfig } from '../../../core/config/configuration';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { CLOCK, type Clock } from '../../../core/common/clock';
import { AuthService } from '../../auth/application/auth.service';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from './ports/identity.repository.port';
import {
  VELOCITY_REPOSITORY,
  type IVelocityRepository,
} from './ports/velocity.repository.port';

const VERIFIED_TIERS = new Set(['tier_1', 'tier_2', 'tier_3']);
/** Tiers that count as "identity verified" for the security-strength signal. */
const IDENTITY_VERIFIED_TIERS = new Set(['tier_2', 'tier_3']);

/** Static tier caps before live usage is folded in. */
interface StaticLimits {
  perTxFiatMax: number;
  dailyFiatMax: number;
  dailyTxCountMax: number;
}

/**
 * Read-only profile composition for the web settings page. Combines the user's
 * auth projection (email/KYC), KYC name, WhatsApp phone, and the tier limits
 * resolved from the layered config. Moves no money (§3.1); reads only.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly auth: AuthService,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    private readonly config: EffectiveConfigService,
    private readonly registry: AssetRegistry,
    @Inject(VELOCITY_REPOSITORY)
    private readonly velocity: IVelocityRepository,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponse> {
    const me = await this.auth.me(userId);
    const [kyc, whatsappPhone, settings, user] = await Promise.all([
      this.identity.findKycProfile(userId),
      this.identity.findWhatsAppAddressByUserId(userId),
      this.identity.findProfileSettings(userId),
      this.identity.loadUser(userId),
    ]);

    const fullName = kyc
      ? [kyc.firstName, kyc.lastName].filter(Boolean).join(' ') || null
      : null;

    // Wave C settings: the user-set contact phone wins over the WhatsApp
    // routing number; the preferred fiat wins only while it is still LIVE in
    // the catalog (an admin disable fails safe back to the default fiat).
    const preferred = settings?.preferredFiatCurrency ?? null;
    const fiatCurrency =
      preferred !== null && this.registry.isCurrencyLive(preferred)
        ? preferred
        : this.registry.defaultFiat();

    // Static caps → fold in the live 24h-window usage (the same VelocityCounter
    // the money-gate reads) for the membership card. Read-only; moves no money
    // (§3.1). Skipped entirely for unverified tiers (no limits apply).
    const staticLimits = this.resolveLimits(me.kycTier, fiatCurrency);
    const limits = staticLimits
      ? await this.withUsage(userId, fiatCurrency, staticLimits)
      : null;

    return {
      email: me.email,
      fullName,
      phone: settings?.profilePhone ?? whatsappPhone ?? null,
      kycStatus: me.kycStatus,
      kycTier: me.kycTier,
      fiatCurrency: fiatCurrency,
      limits,
      // me.payId already carries the claimed PayId (loadMe selects it, and
      // MeResponse.payId was wired in Task 3) — ProfileResponse just never
      // surfaced it, so /profile always showed "Not yet claimed" even for a
      // user who had one. `?? undefined` coerces the nullable auth
      // projection to the ProfileResponse.payId's optional-string shape.
      payId: me.payId ?? undefined,
      memberSince: user ? user.createdAt.toISOString() : null,
      security: this.computeSecurity({
        hasPin: me.hasPin === true,
        emailVerified: me.emailVerified === true,
        deviceBound: user?.pinnedDeviceId != null,
        kycVerified: IDENTITY_VERIFIED_TIERS.has(me.kycTier),
      }),
    };
  }

  private resolveLimits(tier: string, fiat: string): StaticLimits | null {
    if (!VERIFIED_TIERS.has(tier)) return null;
    const limits = this.config.get<LimitsConfig>('limits');
    const fiatLimits = limits?.[fiat];
    if (!fiatLimits) return null;
    const t = fiatLimits[tier as 'tier_1' | 'tier_2' | 'tier_3'];
    return {
      perTxFiatMax: t.perTxFiatMax,
      dailyFiatMax: t.dailyFiatMax,
      dailyTxCountMax: t.dailyTxCountMax,
    };
  }

  /** Folds the current daily-window usage into the static caps. */
  private async withUsage(
    userId: string,
    fiatCurrency: string,
    caps: StaticLimits,
  ): Promise<NonNullable<ProfileResponse['limits']>> {
    const usage = await this.velocity.getDailyUsage(
      userId,
      this.clock.now(),
      fiatCurrency,
    );
    return {
      ...caps,
      dailyFiatUsed: Number(usage.fiatTotal),
      dailyTxCountUsed: usage.txCount,
    };
  }

  /**
   * Derives the membership security-strength summary from four real signals:
   * PIN set, email verified, a bound trusted device, and identity verified
   * (KYC ≥ tier_2). Score is the count of satisfied signals (0..4).
   */
  private computeSecurity(signals: {
    hasPin: boolean;
    emailVerified: boolean;
    deviceBound: boolean;
    kycVerified: boolean;
  }): MembershipSecurity {
    const score = [
      signals.hasPin,
      signals.emailVerified,
      signals.deviceBound,
      signals.kycVerified,
    ].filter(Boolean).length;
    const label =
      score >= 4
        ? 'strong'
        : score === 3
          ? 'good'
          : score === 2
            ? 'fair'
            : 'weak';
    return { score, label };
  }
}
