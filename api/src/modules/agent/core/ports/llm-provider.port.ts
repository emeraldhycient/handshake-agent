import type { Intent } from '@handshake-agent/contracts';

/**
 * A single prior turn of the conversation, supplied by the CALLING LAYER as
 * short-term memory for the agent.
 *
 * This is the agent's only memory affordance, and it is deliberately a plain
 * value object — NOT a LangGraph checkpointer. The calling layer loads the last
 * N persisted turns and passes them in on each call; the embedded agent holds
 * no DB credentials and no checkpointer, preserving extractability (CLAUDE.md
 * §6). `content` is the human-readable text of the turn (the user's message, or
 * the assistant's rendered reply summary).
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Port for the LLM integration layer.
 *
 * The adapter implements this via `model.withStructuredOutput(IntentSchema)` —
 * it calls the real LLM (e.g. ChatAnthropic) and returns a validated `Intent`.
 * The agent core depends on this abstraction only; the concrete adapter lives
 * outside the core (injected at the Nest binding layer, Task 3.3).
 *
 * `history` (optional) carries prior conversation turns so the model can
 * interpret a follow-up message ("50k", "yes the first one") in the context of
 * the question it just asked — enabling multi-turn refinement and real
 * clarification loops. It is supplied by the calling layer; the agent never
 * reads it from a database.
 */
export interface LlmProvider {
  extractIntent(
    userText: string,
    history?: ConversationTurn[],
  ): Promise<Intent>;
}
