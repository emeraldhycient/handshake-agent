/**
 * ProfileSettingsService — the WRITE side of the web settings page (Wave C).
 *
 * changePin      verifies the CURRENT pin through the lockout-protected
 *                PinService (atomic failure counting, §3.4) BEFORE setting the
 *                new one. PIN errors propagate untouched so the global filter
 *                maps them exactly like every other pin surface.
 * updateProfile  non-identity fields ONLY (phone, preferred fiat). KYC-owned
 *                fields (name, DOB, NIN/BVN) are not accepted — immutable on
 *                this surface by design (§3.4). The fiat is re-validated
 *                server-side against the live catalog, fail-closed (§3.3).
 * sessions       list/revoke own sessions; revoking the current one is
 *                allowed and behaves like logout.
 *
 * Moves no money (§3.1).
 */

import { Inject, Injectable } from '@nestjs/common';

import type {
  ProfileResponse,
  ProfileSessionListResponse,
  SetNameRequest,
  UpdateProfileRequest,
} from '@handshake-agent/contracts';

import { PinService } from '../../../core/auth/pin.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  FiatCurrencyNotEnabledError,
  ProfileSessionNotFoundError,
} from '../domain/profile-errors';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from './ports/identity.repository.port';
import {
  PROFILE_SESSION_REPOSITORY,
  type IProfileSessionRepository,
  type ProfileSessionRecord,
} from './ports/profile-session.repository.port';
import { ProfileService } from './profile.service';

const SELF_REVOKE_REASON = 'user_revoked_from_settings';

@Injectable()
export class ProfileSettingsService {
  constructor(
    private readonly pin: PinService,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    @Inject(PROFILE_SESSION_REPOSITORY)
    private readonly sessions: IProfileSessionRepository,
    private readonly registry: AssetRegistry,
    private readonly profile: ProfileService,
  ) {}

  /** Verify the current PIN (lockout-gated), then set the new one. */
  async changePin(
    userId: string,
    currentPin: string,
    newPin: string,
  ): Promise<void> {
    await this.pin.verifyPin(userId, currentPin);
    await this.pin.setPin(userId, newPin);
  }

  /** Persist phone / preferred fiat and return the fresh profile projection. */
  async updateProfile(
    userId: string,
    input: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    // Fail closed BEFORE any write: only a live catalog fiat may be preferred.
    if (
      input.fiatCurrency !== undefined &&
      !this.registry.isCurrencyLive(input.fiatCurrency)
    ) {
      throw new FiatCurrencyNotEnabledError(input.fiatCurrency);
    }

    await this.identity.updateProfileSettings(userId, {
      ...(input.phone !== undefined ? { profilePhone: input.phone } : {}),
      ...(input.fiatCurrency !== undefined
        ? { preferredFiatCurrency: input.fiatCurrency }
        : {}),
    });

    return this.profile.getProfile(userId);
  }

  /**
   * Sets/updates the KYC-profile display name — the onboarding "what should
   * we call you?" step, which runs on the tier_1 session right after
   * signup/verify, BEFORE any KYC submission. Upserts KycProfile (creating it
   * if absent; status/tier take their schema defaults). Idempotent: re-posting
   * updates the names. Unlike `updateProfile`, this deliberately DOES write a
   * KYC-owned field — the two surfaces serve different moments in the
   * lifecycle (pre-KYC name capture vs. post-verification settings, where the
   * name becomes immutable). The input is already trimmed/validated by
   * SetNameRequestSchema at the controller boundary, so it is safe to echo
   * back as the response.
   */
  async setName(
    userId: string,
    input: SetNameRequest,
  ): Promise<SetNameRequest> {
    await this.identity.upsertKycProfileName(userId, input);
    return input;
  }

  /** Own ACTIVE sessions, current one flagged and surfaced first. */
  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<ProfileSessionListResponse> {
    const rows = await this.sessions.listActiveForUser(userId, new Date());
    const sessions = rows.map((row) =>
      this.toContractSession(row, currentSessionId),
    );
    // Current session first; the repository already orders newest-issued first
    // within each group (Array.prototype.sort is stable).
    sessions.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
    return { sessions };
  }

  /**
   * Revoke one OWN session. Foreign/unknown ids fail closed as not-found.
   * Revoking the caller's current session is allowed — it is a logout.
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const revoked = await this.sessions.revokeOwn(
      userId,
      sessionId,
      new Date(),
      SELF_REVOKE_REASON,
    );
    if (!revoked) {
      throw new ProfileSessionNotFoundError();
    }
  }

  private toContractSession(
    row: ProfileSessionRecord,
    currentSessionId: string,
  ): ProfileSessionListResponse['sessions'][number] {
    return {
      id: row.id,
      channel: row.channel,
      userAgent: row.userAgent,
      createdAt: row.issuedAt.toISOString(),
      lastUsedAt: row.lastActivityAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      isCurrent: row.id === currentSessionId,
    };
  }
}
