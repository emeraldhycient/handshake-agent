/**
 * McpToolError — a tool-handler rejection whose message is CLIENT-SAFE.
 *
 * Thrown by MCP tool handlers for ordinary, correctable conditions (unknown
 * transaction, KYC not verified, malformed window spec). The dispatch layer
 * maps it to an `isError` tool result carrying `message` verbatim — so never
 * put balances, addresses, internal ids, or provider detail in one. Any other
 * error class is rendered as a generic failure message (no internals leak).
 *
 * Pure domain: no Nest, no Prisma (CLAUDE.md §4.1).
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}
