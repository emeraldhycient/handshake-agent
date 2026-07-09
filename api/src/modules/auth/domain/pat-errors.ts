/**
 * Personal-access-token domain errors (Wave C). Pure module — no Nest, no
 * Prisma. Stable `code` mirrors the pin-errors pattern so the global
 * DomainExceptionFilter (or a controller) can map without instanceof coupling.
 */

/** The token does not exist, is not owned by the caller, or is already revoked. */
export class PatNotFoundError extends Error {
  readonly code = 'PAT_NOT_FOUND' as const;

  constructor() {
    super('Personal access token not found.');
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
