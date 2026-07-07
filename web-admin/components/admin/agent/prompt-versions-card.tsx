import type { ReactNode } from "react"

import { useAgentInsights } from "@/lib/query/hooks"

import { CardError, CardShell, CardSkeleton } from "./agent-card-shells"

/**
 * System-prompt versions — WIRED to the single LIVE version. There is no
 * prompt-version store (the prompt is generated read-only from the live catalog,
 * §3.1/§6), so exactly one row exists; promote/stage/rollback is Phase 7. The
 * character count is shown as a lightweight change fingerprint.
 */
export function PromptVersionsCard() {
  const insights = useAgentInsights()

  const shell = (children: ReactNode) => (
    <CardShell
      title="System-prompt versions"
      aside={<span className="text-[11px] text-ink3">read-only</span>}
    >
      {children}
    </CardShell>
  )

  if (insights.isLoading) return shell(<CardSkeleton />)
  if (insights.isError) {
    return shell(
      <CardError
        label="Couldn't load prompt version"
        onRetry={() => void insights.refetch()}
      />
    )
  }

  const version = insights.data?.promptVersion
  if (!version) {
    return shell(
      <p className="py-2 text-[12.5px] text-ink3">
        No prompt version available.
      </p>
    )
  }

  return shell(
    <div className="flex items-center gap-[11px] border-b border-line2 py-2.5">
      <span
        className="size-2 flex-none rounded-full bg-tok"
        aria-hidden="true"
      />
      <div className="flex-1">
        <div className="font-mono text-[12.5px] font-bold text-ink">
          {version.label} <span className="text-ink3">· {version.status}</span>
        </div>
        <div className="text-[10.5px] text-ink3">
          Generated from the live catalog · {version.promptChars} chars
        </div>
      </div>
    </div>
  )
}
