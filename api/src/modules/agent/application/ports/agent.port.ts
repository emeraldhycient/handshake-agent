import type { Intent } from '@handshake-agent/contracts';
import type { ConversationTurn } from '../../core/ports/llm-provider.port';

/**
 * DI token for the agent port (AGENT_PORT) — what ConversationService injects.
 * The concrete implementation is AgentService (in agent/application) bound in AgentModule.
 */
export const AGENT_PORT = Symbol('AGENT_PORT');

/**
 * Public surface for anything that needs to run the agent. Consumers inject
 * AGENT_PORT and receive this interface — they never depend on AgentService directly.
 *
 * `history` (optional) is short-term conversation memory supplied by the calling
 * layer (the last N persisted turns). Passing it lets the agent interpret a
 * follow-up message as the answer to the question it just asked. It is optional
 * so existing single-turn callers keep working unchanged; the agent never loads
 * history from a database itself (no checkpointer — CLAUDE.md §6).
 */
export interface IAgentPort {
  run(userText: string, history?: ConversationTurn[]): Promise<Intent>;
}

// Re-export so consumers of the agent port can type the history array without
// reaching into the core ports path directly.
export type { ConversationTurn } from '../../core/ports/llm-provider.port';

/**
 * DI token for the LlmProvider adapter. AgentService injects this token;
 * AgentModule binds it to AnthropicLlmProvider (or a test double in specs).
 *
 * Kept here (application layer) so AgentService can reference it without
 * importing anything from infrastructure — which would violate clean-arch.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
