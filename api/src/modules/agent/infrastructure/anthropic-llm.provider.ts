import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// ESM-under-CJS: always use `import` for @langchain packages (tsc downlevels to require).
// Never hand-write require() — see root CLAUDE.md §6.
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { IntentSchema, type Intent } from '@handshake-agent/contracts';
import type { LlmProvider } from '../core/ports/llm-provider.port';
import type { Env } from '../../../core/config/env.schema';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Concise instruction to the model: extract the user's intent into the
 * structured `IntentSchema`. When genuinely unsure, return `action:'none'`
 * with a clarification question — never guess a financial action.
 *
 * Kept minimal so the IntentSchema itself documents allowed shapes.
 */
const SYSTEM_PROMPT = `You are a financial intent extractor for a crypto/ticket assistant serving Nigerian users.

Given a user message, extract their intent and return it as a structured object matching one of the supported actions:
- buy_crypto: user wants to buy cryptocurrency with fiat
- send_crypto: user wants to send crypto to someone
- receive_crypto: user wants to receive crypto / get their wallet address
- swap: user wants to swap one crypto asset for another
- buy_ticket: user wants to buy an event ticket
- check_balance: user wants to check their wallet balance
- none: intent is unclear — return a short clarification question in the "clarification" field

Rules:
1. Never guess a financial action if the intent is ambiguous — prefer "none" with a clarifying question.
2. Amounts are strings (e.g. "5000" not 5000). Fiat currency defaults to "NGN".
3. Only "USDT" and "BTC" are supported assets at launch.
4. Return exactly one intent matching the schema — no prose, no explanation.`;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Production `LlmProvider` adapter: wraps `ChatAnthropic` behind the port
 * interface so the agent core (and AgentService) never depend on the concrete
 * LangChain class.
 *
 * LAZY construction: `ChatAnthropic` is NOT built in the constructor so the
 * application boots without `ANTHROPIC_API_KEY` being set (it is optional in
 * the env schema — tests and non-LLM paths work fine). The model is created on
 * the first `extractIntent` call and cached thereafter.
 */
@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  /** Lazily initialised on first call to extractIntent. */
  private model: BaseChatModel | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async extractIntent(userText: string): Promise<Intent> {
    const model = this.getOrCreateModel();

    const structured = model.withStructuredOutput(IntentSchema, {
      name: 'extract_intent',
    });

    return structured.invoke([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ]) as Promise<Intent>;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrCreateModel(): BaseChatModel {
    if (this.model) return this.model;

    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not configured — set it in the environment to enable LLM features.',
      );
    }

    const modelId = this.config.get('AGENT_MODEL', { infer: true });

    this.model = new ChatAnthropic({
      apiKey,
      model: modelId,
    });

    return this.model;
  }
}
