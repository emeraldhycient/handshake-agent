import { Module } from '@nestjs/common';
import { AgentService } from './application/agent.service';
import { AGENT_PORT, LLM_PROVIDER } from './application/ports/agent.port';
import { AnthropicLlmProvider } from './infrastructure/anthropic-llm.provider';

/**
 * AgentModule — wires the framework-agnostic agent core into NestJS.
 *
 * Provider bindings:
 *   LLM_PROVIDER  → AnthropicLlmProvider  (ANTHROPIC_API_KEY from env; model id +
 *                                          enablement from the layered config, §7)
 *   AGENT_PORT    → AgentService           (what ConversationService will inject in Phase 2.3)
 *
 * `ConfigModule` and `EffectiveConfigModule` are both global (registered in
 * AppModule) so AnthropicLlmProvider + AgentService receive ConfigService and
 * EffectiveConfigService without an explicit import here.
 *
 * Dependency-cruiser invariants respected:
 *   - agent/core and agent/application never import infrastructure.
 *   - This module (composition root) is allowed to import infra — it's the
 *     only file that "sees" both sides and binds them via tokens.
 *   - Nothing under agent/ imports @prisma/client (CLAUDE.md §3.2).
 */
@Module({
  providers: [
    { provide: LLM_PROVIDER, useClass: AnthropicLlmProvider },
    { provide: AGENT_PORT, useClass: AgentService },
  ],
  exports: [AGENT_PORT],
})
export class AgentModule {}
