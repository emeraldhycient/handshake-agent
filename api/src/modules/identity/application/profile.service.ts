import { Inject, Injectable } from '@nestjs/common';

import type { ProfileResponse } from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { LimitsConfig } from '../../../core/config/configuration';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { AuthService } from '../../auth/application/auth.service';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from './ports/identity.repository.port';

const VERIFIED_TIERS = new Set(['tier_1', 'tier_2', 'tier_3']);

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
  ) {}

  async getProfile(userId: string): Promise<ProfileResponse> {
    const me = await this.auth.me(userId);
    const [kyc, phone] = await Promise.all([
      this.identity.findKycProfile(userId),
      this.identity.findWhatsAppAddressByUserId(userId),
    ]);

    const fullName = kyc
      ? [kyc.firstName, kyc.lastName].filter(Boolean).join(' ') || null
      : null;

    const fiatCurrency = this.registry.defaultFiat();
    const limits = this.resolveLimits(me.kycTier, fiatCurrency);

    return {
      email: me.email,
      fullName,
      phone: phone ?? null,
      kycStatus: me.kycStatus,
      kycTier: me.kycTier,
      fiatCurrency: fiatCurrency,
      limits,
    };
  }

  private resolveLimits(tier: string, fiat: string): ProfileResponse['limits'] {
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
}
