"use client"

/**
 * AgentPage — the embedded-agent oversight surface, reproduced pixel-for-pixel from
 * the operator-console design (docs/design-ref/screens/Agent.html · spec §6.17).
 *
 * This is a DESIGN reproduction: it renders the design's own module-level mock
 * content (no data fetching, no TanStack Query) so the screen looks exactly like
 * the source markup. Real-data reintegration is a separate later step.
 *
 * Layout is two card rows, matching the design's inline grids:
 *   Row 1 (1fr 1fr): "Model & guardrails · read-mostly" (key/val) |
 *                    "System-prompt versions" (dot + version + tag, maker-checker)
 *   Row 2 (1.4fr 1fr): "Tool registry" (mono name + read/write kind chip) |
 *                      "Cost & usage (24h)" (key/val, mono·tabular)
 *
 * This surface is READ-ONLY (§3.1/§6): tools PROPOSE, never execute — the "write"
 * kind chip denotes proposal-only capabilities, not execution. Colour is never the
 * sole signal — the tag/chip text carries the state.
 */
import type {
  AgentGuardrailRow,
  AgentPromptVersion,
  AgentToolRow,
  AgentUsageStat,
} from "@/types/components"

// design mock: "Model & guardrails" key/val rows (design markup `agentParams`, 5 rows).
const AGENT_PARAMS: readonly AgentGuardrailRow[] = [
  { label: "Model", value: "claude-opus-4-8" },
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

function ModelGuardrailsCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Model &amp; guardrails{" "}
        <span className="font-semibold text-ink3">· read-mostly</span>
      </div>
      {AGENT_PARAMS.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between border-b border-line2 py-[9px]"
        >
          <span className="text-[12.5px] text-ink2">{row.label}</span>
          <span className="font-mono text-xs font-bold text-ink">
            {row.value}
          </span>
        </div>
      ))}
    </div>
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
