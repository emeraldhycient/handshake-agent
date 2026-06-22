/**
 * DirectiveGrant service (task 4.2, ADR-0005/0006).
 *
 * Mints and redeems one-shot, HMAC-signed authority grants for high-trust UI
 * directives (itemized confirmation, PIN entry, step-up auth). Security invariants:
 *
 *   - Empty signing key → issue() throws DirectiveNotMintableError (fail closed).
 *   - Plain nonce is returned to the caller; only its SHA-256 hash is persisted.
 *   - Signature is HMAC-SHA256 over a deterministic canonical tuple.
 *   - Consume is atomic (at-most-once) via repository conditional update.
 *   - Signature comparison uses timingSafeEqual to prevent timing attacks.
 *   - Any post-consume mismatch records the failure (grant is already consumed).
 *
 * Canonical tuple for HMAC: directiveId|ref|proposalId|nonce|expiresAt(ISO)|userId|origin
 * (pipe-delimited; all fields are UUID/ISO-8601/enum so no field can embed `|`).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { hmacHex } from '../../../core/crypto/hmac';
import { CLOCK, type Clock } from '../../../core/common/clock';
import {
  DIRECTIVE_REPOSITORY,
  type IDirectiveRepository,
  type DirectiveGrantRecord,
} from './ports/directive.repository.port';
import {
  DirectiveExpiredError,
  DirectiveNotMintableError,
  DirectiveProposalMismatchError,
  DirectiveReplayError,
  DirectiveSignatureError,
} from '../domain/directive-errors';

// High-trust directive refs that must be minted by the engine (origin=engine).
const ENGINE_REFS = new Set([
  'show_confirmation',
  'request_pin',
  'request_step_up',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex of a UTF-8 string. Used for nonce hashing. */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Builds the canonical signing payload.
 *
 * Format: `directiveId|ref|proposalId|nonce|expiresAt|userId|origin`
 * All values are UUIDs, ISO-8601 timestamps, or enum strings — none can
 * contain `|`, so the join is unambiguous (no escaping needed).
 */
function buildCanonical(
  directiveId: string,
  ref: string,
  proposalId: string,
  nonce: string,
  expiresAtIso: string,
  userId: string,
  origin: string,
): string {
  return [
    directiveId,
    ref,
    proposalId,
    nonce,
    expiresAtIso,
    userId,
    origin,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface IssueDirectiveInput {
  proposalId: string;
  userId: string;
  /** UiComponentRef value as a string (e.g. 'show_confirmation'). */
  ref: string;
}

export interface IssueDirectiveOutput {
  directiveId: string;
  /** Plain (unhashed) nonce — must be forwarded to the client; NOT stored. */
  nonce: string;
  expiresAt: Date;
}

export interface ConsumeDirectiveInput {
  directiveId: string;
  /** Plain nonce submitted by the client. */
  nonce: string;
  proposalId: string;
}

@Injectable()
export class DirectiveService {
  private readonly ttlMs: number;
  private readonly signingKey: string;

  constructor(
    @Inject(DIRECTIVE_REPOSITORY)
    private readonly directiveRepo: IDirectiveRepository,
    private readonly config: ConfigService,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {
    const ttlSeconds = this.config.get<number>('directive.ttlSeconds') ?? 300;
    this.ttlMs = ttlSeconds * 1000;
    this.signingKey = this.config.get<string>('DIRECTIVE_SIGNING_KEY') ?? '';
  }

  /**
   * Mints a new one-shot DirectiveGrant.
   *
   * Returns the plain nonce (to be forwarded to the client), directiveId, and
   * expiresAt. The nonce is never stored — only its SHA-256 hash is persisted.
   *
   * Throws DirectiveNotMintableError if the signing key is empty (fail closed).
   */
  async issue(input: IssueDirectiveInput): Promise<IssueDirectiveOutput> {
    if (!this.signingKey) {
      throw new DirectiveNotMintableError(
        'DIRECTIVE_SIGNING_KEY is not configured — cannot mint signed authority.',
      );
    }

    const { proposalId, userId, ref } = input;
    const now = this.clock.now();

    const directiveId = randomUUID();
    // CSPRNG nonce: 32 bytes = 256 bits of entropy, encoded as lowercase hex (64 chars).
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const origin = ENGINE_REFS.has(ref) ? 'engine' : 'agent';
    const nonceHash = sha256Hex(nonce);

    const canonical = buildCanonical(
      directiveId,
      ref,
      proposalId,
      nonce,
      expiresAt.toISOString(),
      userId,
      origin,
    );
    const signatureValue = hmacHex('sha256', this.signingKey, canonical);

    await this.directiveRepo.create({
      directiveId,
      proposalId,
      userId,
      directiveRef: ref,
      origin,
      nonceHash,
      signatureValue,
      issuedAt: now,
      expiresAt,
    });

    return { directiveId, nonce, expiresAt };
  }

  /**
   * Atomically consumes a DirectiveGrant and validates its authenticity.
   *
   * Steps:
   *   1. Attempt atomic consume-on-redeem (issued→consumed, WHERE still issued AND not expired).
   *   2. If null: diagnose via findById and throw DirectiveReplayError or DirectiveExpiredError.
   *   3. Verify nonceHash (sha256(nonce) === grant.nonceHash) — else DirectiveSignatureError.
   *   4. Verify proposalId matches — else DirectiveProposalMismatchError.
   *   5. Recompute HMAC over the canonical tuple and timingSafeEqual — else DirectiveSignatureError.
   *   6. On any post-consume mismatch: record failure (grant is already consumed; that's correct).
   *
   * Returns the validated DirectiveGrantRecord on success.
   */
  async consume(input: ConsumeDirectiveInput): Promise<DirectiveGrantRecord> {
    const { directiveId, nonce, proposalId } = input;
    const now = this.clock.now();

    // 1. Atomic consume attempt.
    const result = await this.directiveRepo.consumeIfIssued({
      directiveId,
      consumedAt: now,
      consumedProposalId: proposalId,
    });

    if (result === null) {
      // 2. Diagnose why consume returned null.
      const existing = await this.directiveRepo.findById(directiveId);

      if (
        existing === null ||
        existing.status === 'consumed' ||
        existing.status === 'cancelled' ||
        existing.status === 'revoked'
      ) {
        throw new DirectiveReplayError();
      }

      if (existing.status === 'expired') {
        throw new DirectiveExpiredError();
      }

      // Any other state (failed, unknown) → treat as replay (fail closed).
      throw new DirectiveReplayError();
    }

    const { grant } = result;

    // 3. Verify nonce hash (post-consume; record failure on any mismatch).
    const computedNonceHash = sha256Hex(nonce);
    if (computedNonceHash !== grant.nonceHash) {
      await this.directiveRepo.recordFailure(
        directiveId,
        'nonce hash mismatch',
      );
      throw new DirectiveSignatureError('nonce hash mismatch');
    }

    // 4. Verify proposalId (post-consume).
    if (proposalId !== grant.proposalId) {
      await this.directiveRepo.recordFailure(
        directiveId,
        'proposal id mismatch',
      );
      throw new DirectiveProposalMismatchError();
    }

    // 5. Recompute HMAC over canonical tuple and compare constant-time.
    const canonical = buildCanonical(
      grant.directiveId,
      grant.directiveRef,
      grant.proposalId,
      nonce,
      grant.expiresAt.toISOString(),
      grant.userId,
      grant.origin,
    );
    const expectedSig = hmacHex('sha256', this.signingKey, canonical);

    // timingSafeEqual requires same-length buffers; both are 64-char hex strings.
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const receivedBuf = Buffer.from(grant.signatureValue, 'utf8');

    const sigValid =
      expectedBuf.length === receivedBuf.length &&
      timingSafeEqual(expectedBuf, receivedBuf);

    if (!sigValid) {
      await this.directiveRepo.recordFailure(
        directiveId,
        'HMAC signature mismatch',
      );
      throw new DirectiveSignatureError('HMAC signature mismatch');
    }

    return grant;
  }
}
