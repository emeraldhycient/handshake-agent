"use client"

/**
 * AgentPage — the embedded-agent oversight surface, reproduced pixel-for-pixel from
 * the operator-console design (docs/design-ref/screens/Agent.html · spec §6.17).
 *
 * The "Model & guardrails" card is WIRED to real data via `useAgentConfig()`
 * (GET /admin/agent/config) — the resolved `modelId` and `enabled` flag come from
 * the layered config (§7). The system-prompt is read-only (§3.1): the contract
 * surfaces only a preview string, never an editable value or the API key.
 *
 * The other three cards (system-prompt versions, tool registry, cost & usage 24h)
 * have NO backing admin endpoint — they render design-faithful representative
 * content until the backend surfaces them (recorded as shape gaps). Their action
 * buttons remain their design toast (Phase 7/8), never executing anything.
 *
 * Layout is two card rows, matching the design's inline grids:
 *   Row 1 (1fr 1fr): "Model & guardrails · read-mostly" (key/val, WIRED) |
 *                    "System-prompt versions" (dot + version + tag, maker-checker)
 *   Row 2 (1.4fr 1fr): "Tool registry" (mono name + read/write kind chip) |
 *                      "Cost & usage (24h)" (key/val, mono·tabular)
 *
 * This surface is READ-ONLY (§3.1/§6): tools PROPOSE, never execute — the "write"
 * kind chip denotes proposal-only capabilities, not execution. Colour is never the
 * sole signal — the tag/chip text carries the state.
 */
import { Skeleton } from "@/components/ui/skeleton"
import { useAgentConfig } from "@/lib/query/hooks"
import { pushToast } from "@/lib/store/toast-store"
import type { AgentConfigView } from "@handshake-agent/contracts"
import type {
  AgentGuardrailRow,
  AgentPromptVersion,
  AgentToolRow,
  AgentUsageStat,
} from "@/types/components"

// Architectural guardrail constants (design markup `agentParams`). These are
// invariant facts of the agent's construction (§3.1/§6), not fetched data — the
// contract exposes no endpoint for them — so they stay static below the two rows
// (Model, Agent enabled) that ARE resolved from the layered config.
const STATIC_GUARDRAILS: readonly AgentGuardrailRow[] = [
  { label: "Structured output", value: "IntentSchema (enforced)" },
  { label: "Checkpointer", value: "none (extractable)" },
  { label: "PIN + step-up", value: "required to execute" },
  { label: "Max tool calls / turn", value: "6" },
]

// design mock: "System-prompt versions" rows (design markup `promptVersions`, 3 rows).
// The dot tone drives the coloured status dot; any change here is maker-checker.
const PROMPT_VERSIONS: readonly AgentPromptVersion[] = [
  {
    version: "v4.2.0",
    tag: "· live",
    meta: "Promoted by Amara Okeke · 2 days ago",
    tone: "success",
    action: "View diff",
  },
  {
    version: "v4.3.0",
    tag: "· staged",
    meta: "Awaiting checker approval · Tunde Adeyemi",
    tone: "warn",
    action: "Review",
  },
  {
    version: "v4.1.3",
    tag: "· archived",
    meta: "Rolled back 6 days ago",
    tone: "muted",
    action: "Restore",
  },
]

// design mock: "Tool registry" rows (design markup `toolRows`, 5+ rows). "read" tools
// return data; "write" tools only PROPOSE a transaction — they never execute (§3.1).
const TOOL_ROWS: readonly AgentToolRow[] = [
  { name: "get_quote", kind: "read" },
  { name: "get_wallet_balance", kind: "read" },
  { name: "list_beneficiaries", kind: "read" },
  { name: "query_transactions", kind: "read" },
  { name: "propose_buy_order", kind: "write" },
  { name: "propose_sell_order", kind: "write" },
  { name: "propose_send", kind: "write" },
  { name: "propose_swap", kind: "write" },
]

// design mock: "Cost & usage (24h)" key/val rows (design markup `agentUsage`, 4 rows).
const AGENT_USAGE: readonly AgentUsageStat[] = [
  { label: "Conversations", value: "1,842" },
  { label: "Input tokens", value: "1,284,930" },
  { label: "Output tokens", value: "312,547" },
  { label: "Est. cost", value: "$48.20" },
]

// Prompt-version dot tone → its token colour (never the sole signal — tag carries the state).
const DOT_TONE: Record<AgentPromptVersion["tone"], string> = {
  success: "bg-tok",
  warn: "bg-twn",
  muted: "bg-ink3",
}

// ─── Model & guardrails (design markup: `agentParams` key/val rows) ─────────────────

/** The card shell — its title is stable across every async branch. */
function ModelGuardrailsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Model &amp; guardrails{" "}
        <span className="font-semibold text-ink3">· read-mostly</span>
      </div>
      {children}
    </div>
  )
}

/** One key/value guardrail row (design markup). */
function GuardrailRow({ label, value }: AgentGuardrailRow) {
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[9px]">
      <span className="text-[12.5px] text-ink2">{label}</span>
      <span className="font-mono text-xs font-bold text-ink">{value}</span>
    </div>
  )
}

/**
 * Model & guardrails — WIRED to `useAgentConfig()`. The `Model` and `Agent
 * enabled` rows resolve from the layered config; the architectural guardrails
 * stay static (no endpoint exposes them). Four async branches per §5.
 */
function ModelGuardrailsCard() {
  const query = useAgentConfig()

  if (query.isLoading) {
    return (
      <ModelGuardrailsShell>
        <div className="flex flex-col gap-2 py-1" aria-busy="true">
          <Skeleton className="h-[19px] w-full" />
          <Skeleton className="h-[19px] w-full" />
          <Skeleton className="h-[19px] w-full" />
          <Skeleton className="h-[19px] w-full" />
          <Skeleton className="h-[19px] w-full" />
        </div>
      </ModelGuardrailsShell>
    )
  }

  if (query.isError) {
    return (
      <ModelGuardrailsShell>
        <div className="rounded-xl border border-sdn bg-sdn/40 px-3.5 py-3 text-center">
          <p className="text-xs font-bold text-tdn">
            Couldn&apos;t load agent config
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-1.5 cursor-pointer rounded-md px-1.5 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
          >
            Retry
          </button>
        </div>
      </ModelGuardrailsShell>
    )
  }

  const config: AgentConfigView | undefined = query.data
  // Defensive: an empty/absent config still renders the card gracefully.
  if (!config) {
    return (
      <ModelGuardrailsShell>
        <p className="py-2 text-[12.5px] text-ink3">
          No agent configuration available.
        </p>
      </ModelGuardrailsShell>
    )
  }

  return (
    <ModelGuardrailsShell>
      <GuardrailRow label="Model" value={config.modelId} />
      <GuardrailRow
        label="Agent enabled"
        value={config.enabled ? "yes" : "no"}
      />
      {STATIC_GUARDRAILS.map((row) => (
        <GuardrailRow key={row.label} label={row.label} value={row.value} />
      ))}
    </ModelGuardrailsShell>
  )
}

// ─── System-prompt versions (design markup: dot + `v.ver v.tag` + meta + action) ────

function PromptVersionsCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-extrabold text-ink">
          System-prompt versions
        </div>
        <span className="text-[11px] text-ink3">change = maker-checker</span>
      </div>
      {PROMPT_VERSIONS.map((version) => (
        <div
          key={version.version}
          className="flex items-center gap-[11px] border-b border-line2 py-2.5"
        >
          <span
            className={`size-2 flex-none rounded-full ${DOT_TONE[version.tone]}`}
            aria-hidden="true"
          />
          <div className="flex-1">
            <div className="font-mono text-[12.5px] font-bold text-ink">
              {version.version} <span className="text-ink3">{version.tag}</span>
            </div>
            <div className="text-[10.5px] text-ink3">{version.meta}</div>
          </div>
          <button
            type="button"
            onClick={() =>
              pushToast(`${version.action} · ${version.version}`, "info")
            }
            className="cursor-pointer rounded-md px-1 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
          >
            {version.action}
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Tool registry (design markup: mono name + inline-styled read/write kind chip) ──

function ToolRegistryCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Tool registry
      </div>
      {TOOL_ROWS.map((tool) => (
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
    </div>
  )
}

// ─── Cost & usage (24h) (design markup: key/val, mono·tabular value) ────────────────

function CostUsageCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Cost &amp; usage (24h)
      </div>
      {AGENT_USAGE.map((stat) => (
        <div
          key={stat.label}
          className="flex items-center justify-between border-b border-line2 py-[9px]"
        >
          <span className="text-[12.5px] text-ink2">{stat.label}</span>
          <span className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
            {stat.value}
          </span>
        </div>
      ))}
    </div>
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
