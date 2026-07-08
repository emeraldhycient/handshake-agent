/**
 * Pure tool listing + dispatch for the MCP server (Wave C).
 *
 * Scope enforcement is layered (defense in depth, §3.1):
 *   1. `listToolsFor` only advertises tools the PAT's scopes allow.
 *   2. `dispatchToolCall` re-checks the scope on EVERY call — an out-of-scope
 *      tool is indistinguishable from an unknown one (no scope probing).
 *
 * Error containment: only `McpToolError` messages (and a small allowlist of
 * catalog validation errors) reach the client; anything else is rendered as a
 * generic failure so internals never leak over JSON-RPC (mirrors the global
 * DomainExceptionFilter posture, which does not run on this transport).
 */

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { McpToolError } from '../domain/mcp-tool-error';
import { AgentUnavailableError } from '../../agent/domain/agent-errors';
import {
  UnsupportedAssetError,
  UnsupportedNetworkError,
} from '../../../core/catalog/catalog-errors';
import type { McpPrincipal, McpToolDefinition } from './mcp-tool-types';

const UNKNOWN_TOOL_MESSAGE = 'Unknown or unavailable tool';
const GENERIC_FAILURE_MESSAGE =
  'Something went wrong handling this tool call. Please try again.';
const AGENT_UNAVAILABLE_MESSAGE =
  'The assistant is temporarily unavailable. Please try again shortly.';

/** Wraps a JSON payload as the standard structured-JSON-text tool result. */
export function jsonToolResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** Builds an isError tool result with a client-safe message. */
export function errorToolResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** The scope-filtered tools/list projection for one principal. */
export function listToolsFor(
  tools: McpToolDefinition[],
  principal: McpPrincipal,
): Tool[] {
  return tools
    .filter((tool) => principal.scopes.includes(tool.scope))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      // Boundary cast: zod-to-json-schema's types bind to the 'zod/v3' entry
      // while ours come from 'zod' — the SAME runtime module; TS cannot see
      // that identity and explodes (TS2589) without the cast.
      inputSchema: zodToJsonSchema(
        tool.inputSchema as never,
      ) as Tool['inputSchema'],
    }));
}

/**
 * Executes one tools/call request: scope re-check → trust-boundary parse →
 * handler → JSON text result. Never throws — every failure becomes a
 * client-safe isError result (`onError` receives the raw error for logging).
 */
export async function dispatchToolCall(
  tools: McpToolDefinition[],
  principal: McpPrincipal,
  name: string,
  args: unknown,
  onError?: (err: unknown, toolName: string) => void,
): Promise<CallToolResult> {
  const tool = tools.find((candidate) => candidate.name === name);
  // Out-of-scope and unknown are the same answer — no scope probing.
  if (!tool || !principal.scopes.includes(tool.scope)) {
    return errorToolResult(`${UNKNOWN_TOOL_MESSAGE}: ${name}`);
  }

  const parsed = tool.inputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return errorToolResult(`Invalid arguments for ${name}: ${detail}`);
  }

  try {
    const payload = await tool.handler(parsed.data, principal);
    return jsonToolResult(payload);
  } catch (err: unknown) {
    onError?.(err, name);
    return errorToolResult(toClientSafeToolError(err));
  }
}

/**
 * Maps a handler failure to a client-safe message. Catalog validation errors
 * carry safe, actionable copy; everything unexpected is generic.
 */
function toClientSafeToolError(err: unknown): string {
  if (err instanceof McpToolError) return err.message;
  if (
    err instanceof UnsupportedAssetError ||
    err instanceof UnsupportedNetworkError
  ) {
    return err.message;
  }
  if (err instanceof AgentUnavailableError) return AGENT_UNAVAILABLE_MESSAGE;
  return GENERIC_FAILURE_MESSAGE;
}
