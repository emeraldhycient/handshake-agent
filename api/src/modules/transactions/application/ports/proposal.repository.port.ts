/**
 * DI token for the Proposal repository. Infrastructure provides the concrete
 * Prisma adapter; application only knows this symbol.
 */
export const PROPOSAL_REPOSITORY = Symbol('PROPOSAL_REPOSITORY');

// ---------------------------------------------------------------------------
// Application-level input/output types — NOT Prisma-generated types.
// Infrastructure maps these to Prisma args; the application stays DB-agnostic.
// ---------------------------------------------------------------------------

// Import the ProposalStatus literal union defined in the transaction port so
// the engine's executable-status check is type-checked end-to-end (I1).
import type { ProposalStatus } from './transaction.repository.port';

export type { ProposalStatus };

export interface CreateProposalData {
  userId: string;
  conversationId?: string;
  /** 'buy' | 'sell' | 'send' | 'swap' | 'ticket_purchase' | 'add_beneficiary' */
  type: string;
  /** Action-specific parameters (JSON-serializable). */
  parameters: Record<string, unknown>;
  /** SHA-256 hex of canonical JSON of parameters. */
  parametersChecksum: string;
  quoteId?: string;
  expiresAt: Date;
}

export interface ProposalRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  type: string;
  /** Narrowed to the known string-literal union (I1). */
  status: ProposalStatus;
  parameters: Record<string, unknown>;
  parametersChecksum: string;
  quoteId: string | null;
  expiresAt: Date;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface IProposalRepository {
  /**
   * Persists a new Proposal row in `pending` status.
   * Returns the auto-generated id.
   */
  create(data: CreateProposalData): Promise<{ id: string }>;

  /**
   * Loads a Proposal by id, or null if not found.
   * Returns all fields required by the execution engine.
   */
  findById(id: string): Promise<ProposalRecord | null>;

  /**
   * Updates the status of a Proposal and optionally sets timestamp fields.
   * Used by the execution engine to mark proposals as executing/executed.
   */
  updateStatus(
    id: string,
    status: ProposalStatus,
    fields?: {
      confirmedAt?: Date;
      executedAt?: Date;
      rejectedAt?: Date;
      rejectionReason?: string;
    },
  ): Promise<void>;

  /**
   * Returns the type string of a Proposal (e.g. 'buy' | 'sell' | 'send'), or
   * null if not found. Used by the Flow endpoint to dispatch the right
   * execution method without loading the full record (W1).
   */
  getType(proposalId: string): Promise<string | null>;

  /**
   * Lists the user's still-actionable proposals (status pending/confirmed AND
   * unexpired as of `asOf`), newest first, bounded. STRICTLY read-only — backs
   * the MCP `list_pending_proposals` tool (Wave C); it never mutates status
   * and never executes (§3.1).
   */
  listPendingForUser(userId: string, asOf: Date): Promise<ProposalRecord[]>;
}
