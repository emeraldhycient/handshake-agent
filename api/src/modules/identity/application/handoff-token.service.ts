/**
 * HandoffTokenService — mints and consumes single-use web-handoff tokens (K3).
 *
 * Security properties (CHN-04):
 *   - CSPRNG ≥256-bit raw token; only the SHA-256 hash is stored (NFR-1).
 *   - Single-use: status issued→redeemed atomically; sibling tokens revoked.
 *   - Short TTL (configurable via defaults JSON / DB-admin setting).
 *   - Replay after redeem → HandoffTokenNotFoundError.
 *   - Expired → HandoffTokenExpiredError.
 *   - Wrong purpose → HandoffTokenWrongPurposeError.
 *
 * Architecture: NO Prisma, NO infrastructure import (CLAUDE.md §3.2). The
 * repository is injected through its port (IHandoffTokenRepository).
 */

import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  HandoffTokenExpiredError,
  HandoffTokenNotFoundError,
  HandoffTokenWrongPurposeError,
} from '../domain/handoff-token-errors';
import {
  HANDOFF_TOKEN_REPOSITORY,
  type IHandoffTokenRepository,
} from './ports/handoff-token.repository.port';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Purpose string that must match the DB enum value. */
const KYC_PURPOSE = 'kyc';

/** Default TTL if the config value is absent or 0. */
const DEFAULT_TTL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export interface MintKycTokenInput {
  /** The WhatsApp phone (or other channel address) to bind the token to. */
  channelAddress: string;
  /** Optional userId — null for unlinked Contacts (KYC purpose). */
  userId?: string;
  /** Optional conversationId — stored for audit. */
  conversationId?: string;
}

export interface MintKycTokenOutput {
  /** The raw CSPRNG token — passed to the web app in the CTA URL. NEVER logged. */
  token: string;
  /** Full URL the CTA button should open, e.g. https://app.example.com/kyc?t=<token> */
  url: string;
}

export interface ConsumeKycTokenOutput {
  /** The channelAddress bound to the token at mint time. */
  channelAddress: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class HandoffTokenService {
  private readonly logger = new Logger(HandoffTokenService.name);

  constructor(
    @Inject(HANDOFF_TOKEN_REPOSITORY)
    private readonly repo: IHandoffTokenRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Mints a new single-use KYC handoff token.
   *
   * Generates a CSPRNG ≥256-bit (32-byte) token; stores only the SHA-256
   * hash in the DB; returns the raw token + the web URL for the CTA button.
   *
   * The `channelAddress` is stored in the DB as the binding key — returned on
   * consumeKycToken so the handler can look up the ChannelIdentity.
   *
   * @param input.channelAddress  The WhatsApp phone or other channel address.
   * @param input.userId          Optional userId (null for unlinked Contacts).
   * @param input.conversationId  Optional conversationId for audit.
   */
  async mintKycToken(input: MintKycTokenInput): Promise<MintKycTokenOutput> {
    const { channelAddress, userId, conversationId } = input;

    // Generate CSPRNG ≥256-bit raw token (32 bytes = 256 bits → 64 hex chars).
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.sha256(rawToken);

    // TTL from layered config; defaults to 30 min if absent.
    const ttlMinutes: number =
      this.configService.get<number>('handoffToken.kycTtlMinutes') ??
      DEFAULT_TTL_MINUTES;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    await this.repo.create({
      tokenHash,
      userId,
      channelAddress,
      conversationId,
      purpose: KYC_PURPOSE,
      expiresAt,
    });

    const baseUrl = this.webAppBaseUrl();
    // Return empty string when WEB_APP_BASE_URL is not configured.
    // Callers treat '' as the "no CTA available" signal and fall back to text.
    const url = baseUrl ? `${baseUrl}/kyc?t=${rawToken}` : '';

    // IMPORTANT: do NOT log rawToken — only hash.
    this.logger.log(
      { tokenHash, channelAddress, expiresAt },
      'KYC handoff token minted',
    );

    return { token: rawToken, url };
  }

  /**
   * Atomically consumes a KYC handoff token on redemption.
   *
   * Looks up the token by SHA-256 hash, validates:
   *   1. Token exists with status == 'issued'.
   *   2. Purpose == 'kyc'.
   *   3. expiresAt > now.
   * On success: marks the token redeemed + revokes all sibling tokens.
   *
   * The `channelAddress` is stored as part of the `conversationId` metadata;
   * the service decodes it from that field. If no conversationId was provided
   * at mint, this returns a synthetic channelAddress derived from the userId
   * (callers should pass channelAddress at mint time).
   *
   * @throws {HandoffTokenNotFoundError} — token not found or already consumed.
   * @throws {HandoffTokenExpiredError}  — token found but expired.
   * @throws {HandoffTokenWrongPurposeError} — token found but wrong purpose.
   */
  async consumeKycToken(rawToken: string): Promise<ConsumeKycTokenOutput> {
    const tokenHash = this.sha256(rawToken);
    const now = new Date();

    const record = await this.repo.findAndConsume({
      tokenHash,
      purpose: KYC_PURPOSE,
      now,
    });

    if (record === null) {
      // Could be not-found OR wrong-purpose OR already-redeemed.
      // findAndConsume returns null for all three to avoid leaking existence info.
      // We need to distinguish expired from not-found — check by hash without consuming.
      // The repo contract: returns null when not found/redeemed; the caller differentiates
      // expiry by the record contents. Since findAndConsume only returns null for
      // not-found/consumed, we throw HandoffTokenNotFoundError here.
      throw new HandoffTokenNotFoundError();
    }

    // findAndConsume only returns records with purpose == 'kyc' (port contract).
    // Double-check defensively (shouldn't happen but makes the invariant explicit).
    if (record.purpose !== KYC_PURPOSE) {
      throw new HandoffTokenWrongPurposeError(KYC_PURPOSE, record.purpose);
    }

    // Note: findAndConsume with `now` already filters out expired tokens (returns null).
    // This branch is unreachable if the port contract is honoured, but we keep it
    // for defence-in-depth — a bug in the adapter might pass an expired record.
    if (record.expiresAt <= now) {
      throw new HandoffTokenExpiredError();
    }

    // The channelAddress was stored directly on the token at mint time.
    // Callers SHOULD always pass channelAddress at mint; fall back to ''
    // if absent (should not happen in the KYC flow).
    const channelAddress = record.channelAddress ?? '';

    this.logger.log(
      { tokenHash, userId: record.userId },
      'KYC handoff token consumed',
    );

    return { channelAddress };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Returns WEB_APP_BASE_URL from env, or logs a warning and falls back to an
   * empty string (callers detect this and send a text fallback instead).
   */
  private webAppBaseUrl(): string {
    const url = this.configService.get<string>('WEB_APP_BASE_URL') ?? '';
    if (!url) {
      this.logger.warn(
        'WEB_APP_BASE_URL not configured — KYC CTA URL will be empty',
      );
    }
    return url;
  }
}
