"use client"

import { PAT_TOKEN_PREFIX } from "@handshake-agent/contracts"
import { CopyButton } from "@/components/shared/copy-button"
import { claudeMcpAddCommand } from "@/lib/settings/mcp-connection"
import { useMcpEndpoint } from "@/hooks/use-mcp-endpoint"
import { MCP_CAPABILITY_NOTE } from "@/constants/settings"

/**
 * How-to-connect docs for the MCP endpoint. The URL is derived from the api
 * client's base URL, SSR-safely ("" on the server — it needs `window.origin`
 * to resolve a relative base, so the URL fills in on the client).
 */
export function McpConnectionDocs() {
  const endpoint = useMcpEndpoint()

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
      <p className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
        Connect an agent
      </p>
      <div>
        <p className="text-[12px] font-semibold text-foreground">
          MCP endpoint
        </p>
        <p className="flex items-center gap-1">
          <code
            className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground"
            translate="no"
          >
            {endpoint}
          </code>
          {endpoint && <CopyButton value={endpoint} label="MCP endpoint" />}
        </p>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-foreground">
          Authentication header
        </p>
        <code className="text-[12px] text-muted-foreground" translate="no">
          Authorization: Bearer {PAT_TOKEN_PREFIX}…
        </code>
      </div>
      {endpoint && (
        <div>
          <p className="text-[12px] font-semibold text-foreground">
            Add to Claude Code
          </p>
          <p className="flex items-start gap-1">
            <code
              className="min-w-0 flex-1 text-[12px] break-all text-muted-foreground"
              translate="no"
            >
              {claudeMcpAddCommand(endpoint)}
            </code>
            <CopyButton
              value={claudeMcpAddCommand(endpoint)}
              label="Claude setup command"
            />
          </p>
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">
        {MCP_CAPABILITY_NOTE}
      </p>
    </div>
  )
}
