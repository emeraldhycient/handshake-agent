/**
 * Domain errors for the agent module.
 *
 * Pure domain — NO Nest, NO Prisma, NO framework imports. Each error carries a
 * stable `code` so the global exception filter can map it to an HTTP status by
 * code without importing the class (CLAUDE.md §4.1).
 */

/**
 * Thrown when the agent / LLM call fails (provider error, timeout, or the model
 * returns output that fails Intent validation). This is a transient upstream
 * failure, NOT a client error: the caller could not even interpret intent, so it
 * must surface as a 5xx (service unavailable), never an opaque 500 that leaks the
 * underlying provider error (I1/I2).
 *
 * Code: AGENT_UNAVAILABLE
 */
export class AgentUnavailableError extends Error {
  readonly code = 'AGENT_UNAVAILABLE' as const;

  constructor() {
    super('The assistant is temporarily unavailable. Please try again.');
    this.name = 'AgentUnavailableError';
    // Restore prototype chain (needed when target < ES2022 transpiles classes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
