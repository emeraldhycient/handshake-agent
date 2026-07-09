/**
 * Connection details for the "Connected agents (MCP)" docs block. The MCP
 * server lives on the same API the axios instance talks to, at /mcp — derive
 * the URL from the client's baseURL so the docs can never drift from where
 * requests actually go.
 */
import { api } from "@/lib/api/client"

const TOKEN_PLACEHOLDER = "<your token>"

/** Absolute URL of the MCP endpoint (resolves a relative base against the page origin). */
export function mcpEndpointUrl(): string {
  const base = (api.defaults.baseURL ?? "/api").replace(/\/+$/, "")
  if (/^https?:\/\//i.test(base)) return `${base}/mcp`
  if (typeof window !== "undefined") {
    return `${window.location.origin}${base}/mcp`
  }
  return `${base}/mcp`
}

/** Copy-paste snippet that registers the endpoint with Claude Code. */
export function claudeMcpAddCommand(
  url: string,
  token: string = TOKEN_PLACEHOLDER
): string {
  return `claude mcp add --transport http handshake ${url} --header "Authorization: Bearer ${token}"`
}
