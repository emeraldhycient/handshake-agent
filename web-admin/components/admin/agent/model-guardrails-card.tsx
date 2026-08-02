import type { ReactNode } from "react"
import type {
  AgentConfigView,
  AgentInsightsView,
} from "@handshake-agent/contracts"

import { useAgentConfig, useAgentInsights } from "@/lib/query/hooks"
import type { AgentKeyValueRowProps } from "@/types"

import { CardError, CardShell, CardSkeleton } from "./agent-card-shells"

/** One key/value guardrail row (design markup). */
function GuardrailRow({ label, value }: AgentKeyValueRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[9px]">
      <span className="text-[12.5px] text-ink2">{label}</span>
      <span className="font-mono text-xs font-bold text-ink">{value}</span>
    </div>
  )
}

/**
 * Model & guardrails — the `Model` + `Agent enabled` rows resolve from
 * `useAgentConfig()`; the guardrail rows resolve from `useAgentInsights()`. Both
 * queries share the card's four async branches (§5); the card shows data only when
 * both have resolved so the operator never sees a half-populated card.
 */
export function ModelGuardrailsCard() {
  const config = useAgentConfig()
  const insights = useAgentInsights()

  const shell = (children: ReactNode) => (
    <CardShell title="Model & guardrails" suffix="· read-mostly">
      {children}
    </CardShell>
  )

  if (config.isLoading || insights.isLoading) return shell(<CardSkeleton />)

  if (config.isError || insights.isError) {
    return shell(
      <CardError
        label="Couldn't load agent config"
        onRetry={() => {
          void config.refetch()
          void insights.refetch()
        }}
      />
    )
  }

  const configData: AgentConfigView | undefined = config.data
  const insightsData: AgentInsightsView | undefined = insights.data
  if (!configData || !insightsData) {
    return shell(
      <p className="py-2 text-[12.5px] text-ink3">
        No agent configuration available.
      </p>
    )
  }

  return shell(
    <>
      <GuardrailRow label="Model" value={configData.modelId} />
      <GuardrailRow
        label="Agent enabled"
        value={configData.enabled ? "yes" : "no"}
      />
      {insightsData.guardrails.map((row) => (
        <GuardrailRow key={row.label} label={row.label} value={row.value} />
      ))}
    </>
  )
}
