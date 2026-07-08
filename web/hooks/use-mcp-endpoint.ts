"use client"

import { useSyncExternalStore } from "react"
import { mcpEndpointUrl } from "@/lib/settings/mcp-connection"

// The endpoint never changes at runtime — nothing to subscribe to.
function subscribe(): () => void {
  return () => {}
}

// During SSR there is no window to resolve a relative base against.
function getServerSnapshot(): string {
  return ""
}

/**
 * SSR-safe MCP endpoint URL: "" on the server / first paint, then the real
 * URL. useSyncExternalStore (the use-is-desktop pattern) avoids the
 * setState-in-effect cascade the react-hooks rule forbids.
 */
export function useMcpEndpoint(): string {
  return useSyncExternalStore(subscribe, mcpEndpointUrl, getServerSnapshot)
}
