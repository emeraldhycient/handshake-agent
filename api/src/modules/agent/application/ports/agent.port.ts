import type { Intent } from '@handshake-agent/contracts';

/**
 * DI token for the agent port (AGENT_PORT) — what ConversationService injects.
 * The concrete implementation is AgentService (in agent/application) bound in AgentModule.
 */
export const AGENT_PORT = Symbol('AGENT_PORT');

/**
 * Public surface for anything that needs to run the agent. Consumers inject
 * AGENT_PORT and receive this interface — they never depend on AgentService directly.
 */
export interface IAgentPort {
  run(userText: string): Promise<Intent>;
}

/**
 * DI token for the LlmProvider adapter. AgentService injects this token;
 * AgentModule binds it to AnthropicLlmProvider (or a test double in specs).
 *
 * Kept here (application layer) so AgentService can reference it without
 * importing anything from infrastructure — which would violate clean-arch.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
