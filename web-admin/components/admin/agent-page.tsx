"use client"

/**
 * AgentPage — the embedded-agent oversight surface (design §6.17). Composition only:
 * two card rows, each card a self-contained section under `components/admin/agent/*`
 * that owns its own read + four async branches.
 *
 * This surface is READ-ONLY (§3.1/§6): tools PROPOSE, never execute — the "write"
 * kind chip denotes proposal-only capabilities, not execution. Colour is never the
 * sole signal — the tag/chip text carries the state.
 */
import { ModelGuardrailsCard } from "@/components/admin/agent/model-guardrails-card"
import { PromptVersionsCard } from "@/components/admin/agent/prompt-versions-card"
import { ToolRegistryCard } from "@/components/admin/agent/tool-registry-card"
import { CostUsageCard } from "@/components/admin/agent/cost-usage-card"
import { ConversationsCard } from "@/components/admin/agent/conversations-card"

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
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <ToolRegistryCard />
        <CostUsageCard />
      </div>

      {/* Row 3 · the conversation/intent log + read-only drawer */}
      <ConversationsCard />
    </div>
  )
}
