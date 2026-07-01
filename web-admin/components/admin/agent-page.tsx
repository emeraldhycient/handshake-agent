"use client"

/**
 * AgentPage — the embedded-agent oversight surface, reproduced pixel-for-pixel from
 * the operator-console design (docs/design-ref/screens/Agent.html · spec §6.17).
 *
 * The "Model & guardrails" card is WIRED to two hooks: `useAgentConfig()`
 * (GET /admin/agent/config) for the resolved `modelId` + `enabled` flag from the
 * layered config (§7), and `useAgentInsights()` (GET /admin/agent/insights) for the
 * guardrail rows (structured-output / checkpointer / PIN-step-up / max-tool-calls —
 * architectural facts + the config-tunable max-tool-calls). The system prompt is
 * read-only (§3.1): the contract surfaces only a preview string, never an editable
 * value or the API key.
 *
 * The other three cards are ALSO WIRED to `useAgentInsights()`:
 *   - System-prompt versions → the single live version (there is no version store;
 *     promote/stage is Phase 7), with the prompt length as a change fingerprint.
 *   - Tool registry → the typed-tool set derived from the real intent-action union.
 *   - Cost & usage (24h) → REAL rolling-24h counts (conversations / inbound / outbound).
 *     The schema stores NO token or dollar-cost data, so the card reports measurable
 *     counts rather than fabricating tokens/cost (§3.6).
 *
 * Layout is two card rows, matching the design's inline grids:
 *   Row 1 (1fr 1fr): "Model & guardrails · read-mostly" (key/val, WIRED) |
 *                    "System-prompt versions" (dot + version + tag, WIRED · live-only)
 *   Row 2 (1.4fr 1fr): "Tool registry" (mono name + read/write kind chip, WIRED) |
 *                      "Cost & usage (24h)" (key/val, mono·tabular, WIRED)
 *
 * This surface is READ-ONLY (§3.1/§6): tools PROPOSE, never execute — the "write"
 * kind chip denotes proposal-only capabilities, not execution. Colour is never the
 * sole signal — the tag/chip text carries the state.
 */
import { Skeleton } from "@/components/ui/skeleton"
import { useAgentConfig, useAgentInsights } from "@/lib/query/hooks"
import type {
  AgentConfigView,
  AgentInsightsView,
} from "@handshake-agent/contracts"

// ─── Shared card shells + async branches ────────────────────────────────────────────

/** A card shell — its title is stable across every async branch. */
function CardShell({
  title,
  suffix,
  aside,
  children,
}: {
  title: string
  suffix?: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-extrabold text-ink">
          {title}
          {suffix ? (
            <span className="font-semibold text-ink3"> {suffix}</span>
          ) : null}
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** Five-row loading skeleton, shared by every card. */
function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-1" aria-busy="true">
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
    </div>
  )
}

/** The shared error branch — a message + a Retry that re-runs the query. */
function CardError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-sdn bg-sdn/40 px-3.5 py-3 text-center">
      <p className="text-xs font-bold text-tdn">{label}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1.5 cursor-pointer rounded-md px-1.5 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
      >
        Retry
      </button>
    </div>
  )
}

// ─── Model & guardrails (design markup: `agentParams` key/val rows) ─────────────────

/** One key/value guardrail row (design markup). */
function GuardrailRow({ label, value }: { label: string; value: string }) {
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
function ModelGuardrailsCard() {
  const config = useAgentConfig()
  const insights = useAgentInsights()

  const shell = (children: React.ReactNode) => (
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

// ─── System-prompt versions (design markup: dot + `v.ver v.tag` + meta) ─────────────

/**
 * System-prompt versions — WIRED to the single LIVE version. There is no
 * prompt-version store (the prompt is generated read-only from the live catalog,
 * §3.1/§6), so exactly one row exists; promote/stage/rollback is Phase 7. The
 * character count is shown as a lightweight change fingerprint.
 */
function PromptVersionsCard() {
  const insights = useAgentInsights()

  const shell = (children: React.ReactNode) => (
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
      <p className="py-2 text-[12.5px] text-ink3">No prompt version available.</p>
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

// ─── Tool registry (design markup: mono name + inline-styled read/write kind chip) ──

/**
 * Tool registry — WIRED to the typed-tool set derived from the real intent-action
 * union. "read" tools return data; "write" tools only PROPOSE, they never execute
 * (§3.1). Four async branches (§5).
 */
function ToolRegistryCard() {
  const insights = useAgentInsights()

  const shell = (children: React.ReactNode) => (
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

// ─── Cost & usage (24h) (design markup: key/val, mono·tabular value) ────────────────

/** One usage key/value row. */
function UsageRow({ label, value }: { label: string; value: string }) {
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
function CostUsageCard() {
  const insights = useAgentInsights()

  const shell = (children: React.ReactNode) => (
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

// ─── Page ───────────────────────────────────────────────────────────────────────────

export function AgentPage() {
  return (
    <div
      data-screen-label="Agent config"
      className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto px-[30px] pt-[26px] pb-[60px]"
    >
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Agent config
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          LLM runtime, prompt versions, tool registry and usage. Tools{" "}
          <b>propose</b>, never execute.
        </p>
      </div>

      {/* Row 1 · 1fr 1fr */}
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ModelGuardrailsCard />
        <PromptVersionsCard />
      </div>

      {/* Row 2 · 1.4fr 1fr */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <ToolRegistryCard />
        <CostUsageCard />
      </div>
    </div>
  )
}
