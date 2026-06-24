/**
 * Domain errors for DirectiveGrant (ADR-0005/0006). Pure module — no Nest,
 * no Prisma. Each error carries a stable code for programmatic handling.
 */

export class DirectiveNotMintableError extends Error {
  /** Stable code for programmatic handling (logged, never exposed to clients). */
  readonly code = 'DIRECTIVE_NOT_MINTABLE';

  constructor(reason: string) {
    super(`Directive cannot be minted: ${reason}`);
    this.name = 'DirectiveNotMintableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DirectiveExpiredError extends Error {
  readonly code = 'DIRECTIVE_EXPIRED';

  constructor() {
    super('Directive grant has expired.');
    this.name = 'DirectiveExpiredError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DirectiveReplayError extends Error {
  readonly code = 'DIRECTIVE_REPLAY';

  constructor() {
    super(
      'Directive grant has already been consumed or does not exist (replay rejected).',
    );
    this.name = 'DirectiveReplayError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DirectiveProposalMismatchError extends Error {
  readonly code = 'DIRECTIVE_PROPOSAL_MISMATCH';

  constructor() {
    super('Directive grant proposalId does not match the provided proposalId.');
    this.name = 'DirectiveProposalMismatchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DirectiveSignatureError extends Error {
  readonly code = 'DIRECTIVE_SIGNATURE_INVALID';

  constructor(detail?: string) {
    super(
      detail
        ? `Directive grant signature invalid: ${detail}`
        : 'Directive grant signature invalid.',
    );
    this.name = 'DirectiveSignatureError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
