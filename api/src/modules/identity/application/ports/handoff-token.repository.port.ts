/**
 * Port for HandoffToken persistence (K3 — CHN-04).
 *
 * Infrastructure provides the Prisma adapter; application depends only on
 * this interface (CLAUDE.md §3.2 / §4.1). The application layer stores only
 * the SHA-256 hash — never the raw token.
 */

export const HANDOFF_TOKEN_REPOSITORY = Symbol('HANDOFF_TOKEN_REPOSITORY');

// ---------------------------------------------------------------------------
// Application-level record types (NOT the generated Prisma types)
// ---------------------------------------------------------------------------

/** Minimal representation of a stored handoff token row. */
export interface HandoffTokenRecord {
  id: string;
  tokenHash: string;
  /** Null for unlinked Contacts (KYC purpose) until KYC completes. */
  userId: string | null;
  /** The channel address (e.g. WhatsApp phone E.164) bound at mint time. */
  channelAddress: string | null;
  conversationId: string | null;
  /** e.g. 'kyc' */
  purpose: string;
  /** e.g. 'issued' | 'redeemed' | 'expired' | 'revoked' */
  status: string;
  issuedAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Input types for repository operations
// ---------------------------------------------------------------------------

export interface CreateHandoffTokenInput {
  tokenHash: string;
  /** Null for unlinked Contacts (KYC purpose). */
  userId?: string;
  /** The channel address bound to this token — returned on consumeKycToken. */
  channelAddress?: string;
  conversationId?: string;
  purpose: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface IHandoffTokenRepository {
  /**
   * Stores a new token row (status = 'issued').
   * Only the hash is persisted; the raw token is never stored.
   */
  create(input: CreateHandoffTokenInput): Promise<HandoffTokenRecord>;

  /**
   * Atomically finds the token by hash, checks purpose == expected,
   * status == 'issued', expiresAt > now — and if valid:
   *   1. Updates the found token: status → 'redeemed', redeemedAt = now.
   *   2. Updates all OTHER issued tokens for the same userId+purpose → 'revoked'
   *      (sibling-token invalidation).
   *
   * Returns the record as it was BEFORE the update (so callers get the bound
   * channelAddress metadata stored in conversationId if needed).
   *
   * If the token row is not found or status != 'issued' → returns null
   * (caller distinguishes not-found from expired via the record's expiresAt).
   */
  findAndConsume(params: {
    tokenHash: string;
    purpose: string;
    now: Date;
  }): Promise<HandoffTokenRecord | null>;

  /**
   * Returns all issued (not redeemed/revoked) tokens for a given channelAddress +
   * purpose whose expiresAt is in the future. Used to check for existing tokens
   * before minting a new one (dedup/revoke old tokens).
   */
  findActiveForChannel(params: {
    channelAddress: string;
    purpose: string;
    now: Date;
  }): Promise<HandoffTokenRecord[]>;
}
