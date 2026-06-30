import { Injectable, Inject } from '@nestjs/common';
import type { Intent } from '@handshake-agent/contracts';
import { runAgent } from '../core/agent.graph';
import type { LlmProvider } from '../core/ports/llm-provider.port';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AgentUnavailableError } from '../domain/agent-errors';
import { LLM_PROVIDER, type IAgentPort } from './ports/agent.port';

/**
 * Nest-facing agent service: the concrete implementation of `IAgentPort`.
 *
 * This service is in the `application` layer — it imports only:
 *   - The agent core (`runAgent` + `LlmProvider` port interface)
 *   - The port tokens/interfaces from this layer
 *   - Nest DI decorators
 *
 * It imports nothing from any feature module's `infrastructure` (enforced by
 * dependency-cruiser rule `api-agent-pure-layers-no-infra`); the concrete
 * `LlmProvider` implementation is injected via the `LLM_PROVIDER` token at module
 * level. The layered config (`EffectiveConfigService`, in `core/config/application`)
 * is the only non-port collaborator — it gates enablement (§3.1/§7). The agent
 * CORE (`agent/core`) stays framework-agnostic; only this thin Nest adapter touches it.
 *
 * TODO(perf): cache the compiled LangGraph graph instance across calls rather
 * than recompiling it on every `run()` invocation — acceptable for the current
 * iteration but will add latency under load.
 */
@Injectable()
export class AgentService implements IAgentPort {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly effectiveConfig: EffectiveConfigService,
  ) {}

  async run(userText: string): Promise<Intent> {
    // Enablement gate (admin-tunable agent.enabled, §7): fail-closed BEFORE any
    // LLM call when the agent is disabled. Surfaces as 503 (AGENT_UNAVAILABLE).
    if (this.effectiveConfig.get<boolean>('agent.enabled') === false) {
      throw new AgentUnavailableError();
    }

    // Per-call graph compile (see TODO above). The LlmProvider closure is
    // captured inside runAgent — it is never read directly from the graph.
    return runAgent({ userText, llm: this.llm });
  }
}
