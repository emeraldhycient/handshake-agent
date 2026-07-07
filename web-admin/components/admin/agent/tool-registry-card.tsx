import type { ReactNode } from "react"

import { useAgentInsights } from "@/lib/query/hooks"

import { CardError, CardShell, CardSkeleton } from "./agent-card-shells"

/**
 * Tool registry — WIRED to the typed-tool set derived from the real intent-action
 * union. "read" tools return data; "write" tools only PROPOSE, they never execute
 * (§3.1). Four async branches (§5).
 */
export function ToolRegistryCard() {
  const insights = useAgentInsights()

  const shell = (children: ReactNode) => (
    <CardShell title="Tool registry">{children}</CardShell>
  )

  if (insights.isLoading) return shell(<CardSkeleton />)
  if (insights.isError) {
    return shell(
      <CardError
        label="Couldn't load tool registry"
        onRetry={() => void insights.refetch()}
      />
    )
  }

  const tools = insights.data?.tools ?? []
  if (tools.length === 0) {
    return shell(
      <p className="py-2 text-[12.5px] text-ink3">No tools registered.</p>
    )
  }

  return shell(
    <>
      {tools.map((tool) => (
        <div
          key={tool.name}
          className="flex items-center gap-[11px] border-b border-line2 py-[9px]"
        >
          <span className="flex-1 font-mono text-xs font-semibold text-ink">
            {tool.name}
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
              tool.kind === "read" ? "bg-card2 text-ink2" : "bg-sif text-tif"
            }`}
          >
            {tool.kind}
          </span>
        </div>
      ))}
    </>
  )
}
