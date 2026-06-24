import type { Intent } from '@handshake-agent/contracts';

/**
 * Port for the LLM integration layer.
 *
 * The adapter implements this via `model.withStructuredOutput(IntentSchema)` —
 * it calls the real LLM (e.g. ChatAnthropic) and returns a validated `Intent`.
 * The agent core depends on this abstraction only; the concrete adapter lives
 * outside the core (injected at the Nest binding layer, Task 3.3).
 */
export interface LlmProvider {
  extractIntent(userText: string): Promise<Intent>;
}
