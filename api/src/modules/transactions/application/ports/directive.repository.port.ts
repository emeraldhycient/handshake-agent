/**
 * Port for DirectiveGrant persistence (task 4.2, ADR-0005/0006).
 *
 * Application code depends ONLY on this interface and the DI token; the
 * concrete Prisma adapter lives in `infrastructure/`. `dependency-cruiser`
 * forbids the application layer from importing the infrastructure layer.
 */

export const DIRECTIVE_REPOSITORY = Symbol('DIRECTIVE_REPOSITORY');

// ---------------------------------------------------------------------------
// Application-level record type — NOT the Prisma-generated type.
// Infrastructure maps this to/from Prisma rows; the application stays DB-agnostic.
// ---------------------------------------------------------------------------

export interface DirectiveGrantRecord {
  directiveId: string;
  proposalId: string;
  userId: string;
  /** Matches UiComponentRef enum values as strings. */
  directiveRef: string;
  /** Matches DirectiveOrigin enum values as strings. */
  origin: string;
  /** SHA-256 hex of the plain nonce — only this is stored. */
  nonceHash: string;
  /** HMAC-SHA256 hex over the canonical tuple. */
  signatureValue: string;
  /** Matches DirectiveGrantStatus enum values as strings. */
  status: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedProposalId: string | null;
  failureReason: string | null;
  failureCount: number;
}

// ---------------------------------------------------------------------------
// Input types for repository operations
// ---------------------------------------------------------------------------

export interface CreateDirectiveGrantData {
  directiveId: string;
  proposalId: string;
  userId: string;
  directiveRef: string;
  origin: string;
  nonceHash: string;
  signatureValue: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface ConsumeIfIssuedInput {
  directiveId: string;
  consumedAt: Date;
  consumedProposalId: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IDirectiveRepository {
  /**
   * Inserts a new DirectiveGrant row with status=issued.
   */
  create(data: CreateDirectiveGrantData): Promise<void>;

  /**
   * Atomic consume: updates status issued→consumed WHERE directiveId AND
   * status='issued' AND expiresAt > now. Returns the grant if exactly one
   * row was updated, null otherwise (already-consumed / expired / not found).
   *
   * Atomicity guarantees at-most-once redemption.
   */
  consumeIfIssued(
    input: ConsumeIfIssuedInput,
  ): Promise<{ grant: DirectiveGrantRecord } | null>;

  /**
   * Loads a DirectiveGrant by directiveId for post-failure diagnosis
   * (was it consumed already? expired?). Returns null if not found.
   */
  findById(directiveId: string): Promise<DirectiveGrantRecord | null>;

  /**
   * Increments failureCount and, if the grant is in a non-terminal state,
   * sets status=failed. Used after a signature / nonce / proposalId mismatch
   * that occurred AFTER the grant was already atomically consumed.
   */
  recordFailure(directiveId: string, reason: string): Promise<void>;
}
