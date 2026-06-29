import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
// ESM-under-CJS: always use `import` for @langchain packages (tsc downlevels to require).
// Never hand-write require() — see root CLAUDE.md §6.
import { ChatAnthropic } from '@langchain/anthropic';
import { IntentSchema, type Intent } from '@handshake-agent/contracts';

// The Anthropic tool API requires a tool's `input_schema` to be a root JSON
// object (`"type": "object"`). IntentSchema is a discriminated UNION, which
// serialises to a root-level `anyOf` with no `type` — Anthropic rejects it
// ("tools.0.custom.input_schema.type: Field required"). Wrapping the union in
// an object gives the tool a valid root object schema; we unwrap `.intent`.
const ExtractIntentSchema = z.object({ intent: IntentSchema });
import type { LlmProvider } from '../core/ports/llm-provider.port';
import type { Env } from '../../../core/config/env.schema';
import { AssetRegistry } from '../../../core/catalog/asset-registry';

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
 *
 * The system prompt is built dynamically from the `AssetRegistry` so the
 * supported-asset and default-fiat basket are always in sync with the catalog
 * config — no hardcoded values (root CLAUDE.md §7).
 */
@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  /** Lazily initialised on first call to extractIntent. */
  // Concrete ChatAnthropic, not BaseChatModel: @langchain/anthropic and
  // @langchain/core resolve BaseChatModel to distinct class identities, so
  // assigning ChatAnthropic to a BaseChatModel field trips TS2322 under ts-jest
  // (tsc tolerates it via skipLibCheck). The adapter only needs
  // withStructuredOutput/invoke, both on ChatAnthropic.
  private model: ChatAnthropic | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly assetRegistry: AssetRegistry,
  ) {}

  async extractIntent(userText: string): Promise<Intent> {
    const model = this.getOrCreateModel();

    const structured = model.withStructuredOutput(ExtractIntentSchema, {
      name: 'extract_intent',
    });

    const result = (await structured.invoke([
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: userText },
    ])) as { intent: Intent };

    return result.intent;
  }

  /**
   * Builds the system prompt from the asset catalog so the supported-asset
   * basket and default fiat are never hardcoded in source.
   *
   * Called on each `extractIntent` invocation (the string is small; no caching
   * needed). Keeping it as a method (not a constructor-time field) means tests
   * can call it directly to assert prompt content without triggering the lazy
   * ChatAnthropic build.
   */
  buildSystemPrompt(): string {
    const enabledAssets = this.assetRegistry.enabledCryptoAssets();
    const defaultFiat = this.assetRegistry.defaultFiat();
    const assetList = enabledAssets.map((s) => `"${s}"`).join(', ');

    return `You are a financial intent extractor for a crypto/ticket assistant serving Nigerian users.

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
2. Amounts are strings (e.g. "5000" not 5000). Fiat currency defaults to "${defaultFiat}".
3. Only ${assetList} are supported assets.
4. Return exactly one intent matching the schema — no prose, no explanation.`;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrCreateModel(): ChatAnthropic {
    if (this.model) return this.model;

    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not configured — set it in the environment to enable LLM features.',
      );
    }

    const modelId = this.config.get('AGENT_MODEL', { infer: true });

    const model = new ChatAnthropic({ apiKey, model: modelId });
    this.model = model;
    return model;
  }
}
