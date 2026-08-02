import type { ReactNode } from "react"

import { useAgentInsights } from "@/lib/query/hooks"
import type { AgentKeyValueRowProps } from "@/types"

import { CardError, CardShell, CardSkeleton } from "./agent-card-shells"

/** One usage key/value row. */
function UsageRow({ label, value }: AgentKeyValueRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[9px]">
      <span className="text-[12.5px] text-ink2">{label}</span>
      <span className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
        {value}
      </span>
    </div>
  )
}

/**
 * Cost & usage (24h) — WIRED to REAL rolling-24h counts. The schema stores no token
 * counts or dollar cost, so the card reports what is actually measurable —
 * conversations touched, inbound messages, outbound replies — rather than
 * fabricating tokens/cost (§3.6). Four async branches (§5).
 */
export function CostUsageCard() {
  const insights = useAgentInsights()

  const shell = (children: ReactNode) => (
    <CardShell title="Cost & usage (24h)">{children}</CardShell>
  )

  if (insights.isLoading) return shell(<CardSkeleton />)
  if (insights.isError) {
    return shell(
      <CardError
        label="Couldn't load usage"
        onRetry={() => void insights.refetch()}
      />
    )
  }

  const usage = insights.data?.usage24h
  if (!usage) {
    return shell(
      <p className="py-2 text-[12.5px] text-ink3">No usage data available.</p>
    )
  }

  const rows = [
    { label: "Conversations", value: usage.conversations.toLocaleString() },
    {
      label: "Inbound messages",
      value: usage.inboundMessages.toLocaleString(),
    },
    {
      label: "Outbound replies",
      value: usage.outboundReplies.toLocaleString(),
    },
  ]

  return shell(
    <>
      {rows.map((row) => (
        <UsageRow key={row.label} label={row.label} value={row.value} />
      ))}
    </>
  )
}
