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
import type {
  ConversationTurn,
  LlmProvider,
} from '../core/ports/llm-provider.port';
import type { Env } from '../../../core/config/env.schema';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

// Intent fields that carry a money amount and must be normalized to a bare
// decimal string before IntentSchema.parse runs. The model is also prompted to
// emit bare decimals; this deterministic backstop guarantees a ₦/comma-laden
// amount never surfaces as "assistant unavailable" (a 5xx) for a parseable
// figure (finding: amount mis-parse).
const AMOUNT_FIELDS = ['fiatAmount', 'cryptoAmount', 'amount'] as const;

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
    private readonly effectiveConfig: EffectiveConfigService,
  ) {}

  async extractIntent(
    userText: string,
    history: ConversationTurn[] = [],
  ): Promise<Intent> {
    const model = this.getOrCreateModel();

    const structured = model.withStructuredOutput(ExtractIntentSchema, {
      name: 'extract_intent',
    });

    // Thread prior turns between the system prompt and the current user message
    // so a follow-up ("50k", "the first one") is interpreted as the answer to
    // the agent's previous question (short-term memory, supplied by the calling
    // layer — no DB checkpointer here, CLAUDE.md §6).
    const result = (await structured.invoke([
      { role: 'system', content: this.buildSystemPrompt() },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: userText },
    ])) as { intent: Intent };

    return this.normalizeIntent(result.intent);
  }

  /**
   * Deterministic backstop: strips currency symbols (₦, $), thousands
   * separators (commas), and surrounding whitespace from any amount field so a
   * model-emitted "₦50,000" becomes the schema-valid "50000". The model is also
   * instructed to do this in the prompt; this guarantees the result regardless,
   * so a parseable amount never bubbles out as an "assistant unavailable" 5xx.
   *
   * Non-amount intents (none, receive, check_balance, query_transactions) pass
   * through untouched.
   */
  private normalizeIntent(intent: Intent): Intent {
    // Operate on a shallow copy as a loose record: amount fields exist only on
    // some union members, so we probe by key rather than narrowing the union.
    const record = { ...intent } as Record<string, unknown>;
    for (const field of AMOUNT_FIELDS) {
      const value = record[field];
      if (typeof value === 'string') {
        record[field] = this.normalizeAmount(value);
      }
    }
    return record as Intent;
  }

  /** Strips ₦/$, commas, and whitespace from an amount string. */
  private normalizeAmount(raw: string): string {
    return raw.replace(/[₦$,\s]/g, '');
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
    const liveFiats = this.assetRegistry.enabledFiats();
    const assetList = enabledAssets.map((s) => `"${s}"`).join(', ');
    const liveFiatList = liveFiats.map((f) => `"${f}"`).join(', ');

    return `You are a financial intent extractor for a crypto/ticket assistant.

Given a user message, extract their intent and return it as a structured object matching one of the supported actions:
- buy_crypto: user wants to buy cryptocurrency with fiat
- send_crypto: user wants to send crypto to someone. If they name the recipient (a person or nickname), set "recipientNickname" — see the RECIPIENTS rule.
- receive_crypto: user wants to receive crypto / get their wallet address
- swap: user wants to swap one crypto asset for another crypto asset (crypto-to-crypto only, no fiat). Extract fromAsset (the asset to swap out of), toAsset (the asset to receive), and amount (of fromAsset to swap). Both fromAsset and toAsset must be supported crypto assets.
- buy_ticket: user wants to buy an event ticket
- check_balance: user wants to check their wallet balance. If they name a specific asset (e.g. "my USDT balance"), set "asset" to that symbol; if they ask for everything ("what's my balance", "show my assets"), omit "asset".
- query_transactions: user wants to see their transaction history / past activity, or download a statement
- get_rate: user asks the exchange rate / PRICE of ONE crypto asset ("what's the USDT/NGN rate?", "how much is 1 USDT in naira?", "USDT price"). Set "asset" to the crypto symbol and "fiatCurrency" to the fiat they name (omit it to use the default ${defaultFiat}). This is READ-ONLY — it only shows a price; it NEVER buys or sells. A pure price/rate question is get_rate, NOT buy_crypto/sell_crypto.
- list_rates: user asks to see ALL rates/prices ("show me all the rates", "what are your prices?", "list rates"). No parameters. READ-ONLY.
- none: intent is unclear — return a short clarification question in the "clarification" field

Rules:
1. Never guess a financial action if the intent is ambiguous — prefer "none" with a clarifying question in the "clarification" field.
2. ACTION KNOWN BUT AMOUNT MISSING → clarify, never error. If the user names an action (buy/sell/send/swap) but does NOT state an amount (e.g. "buy USDT", "send some money", "I want to swap"), DO NOT emit a buy/sell/send/swap intent with a guessed or empty amount — return action "none" with a targeted clarification asking for the amount (e.g. "How much USDT would you like to buy?"). A missing amount is the expected case, not an error.
3. ECHO BACK WHAT YOU PARSED. When you DO resolve a money action from free text, write a short confirmation of the parsed parameters into the clarification-style summary so the user can catch a misread — but still return the structured intent. (The calling layer decides whether to show a confirm step.)
4. AMOUNTS: emit a BARE decimal STRING (e.g. "5000", not 5000 and not "₦5,000"). STRIP currency symbols (₦, $) and thousands separators (commas) and surrounding spaces: "₦50,000" → "50000", "$1,234.50" → "1234.50", "50,000" → "50000". Default fiat currency is "${defaultFiat}".
5. Only ${assetList} are supported crypto assets.
6. MULTIPLE ACTIONS IN ONE MESSAGE → do NOT silently pick one. If the message contains two or more distinct money actions (e.g. "buy 5k USDT and send 20 to John"), return action "none" with a clarification that names what you saw and asks which to do first — never drop half the instruction.
7. LANGUAGE: the user may write in English, Nigerian Pidgin, Hausa, Yoruba, or Igbo. Understand the message in whatever language it is in and write the "clarification" reply in the user's own language. If you are NOT confident about the amount or the action in a non-English message, return action "none" with a clarifying question in the user's language rather than guessing — a confident-but-wrong parse can move the wrong amount of money.
8. Return exactly one intent matching the schema — no prose, no explanation.
9. For query_transactions you express the time range one of THREE ways — the SERVER computes the actual dates, you NEVER compute calendar dates yourself:
   a. "period" — for the common named ranges: today, yesterday, this_week, last_week, this_month, last_month, all (e.g. "today", "last week", "this month").
   b. "relativeAmount" (a positive integer) + "relativeUnit" (one of minute, hour, day, week, month, year) — for any "last N <unit>" or sub-day phrase that a named period can't express. Examples: "an hour ago" → {relativeAmount:1, relativeUnit:"hour"}; "last 24 hours" → {relativeAmount:24, relativeUnit:"hour"}; "the last 30 minutes" → {relativeAmount:30, relativeUnit:"minute"}; "last 2 weeks" → {relativeAmount:2, relativeUnit:"week"}; "past 6 months" → {relativeAmount:6, relativeUnit:"month"}; "last year" → {relativeAmount:1, relativeUnit:"year"}. Always emit BOTH relativeAmount and relativeUnit together.
   c. "from"/"to" (ISO YYYY-MM-DD) — ONLY when the user states an explicit calendar range (e.g. "from June 1 to June 15").
   Pick exactly one of (a)/(b)/(c). Prefer a named period when one fits; otherwise use the relative spec; use from/to only for explicit calendar dates.
10. Set "txType" (buy/sell/send/receive) when the user names a direction (e.g. "what did I send"). Set "download": true only when the user asks for a file/statement/PDF.
11. Fiat currency: extract whatever supported fiat currency the user names into the "fiatCurrency" field (do NOT refuse or reject it — the engine decides whether the currency is live). Currently live/settleable fiats are ${liveFiatList}; other supported fiats may be requested but will be handled by the engine.
12. RECIPIENTS (send_crypto and sell_crypto): when the user names WHO the money goes to as a person, name, or nickname (e.g. "send 50 USDT to mum" → recipientNickname: "mum"; "sell 100 USDT to my GTB account" → recipientNickname: "my GTB account"), extract that name verbatim into "recipientNickname". It is ONLY a lookup key — the server resolves it against the user's own saved recipients; you never resolve destinations yourself. NEVER extract a wallet address, bank account number, or bank code into recipientNickname or any other field — model output is never a destination. If the user pastes a raw address or account number as the destination, return action "none" with a clarification asking them to first save it as a recipient (or name one of their saved recipients).`;
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

    // Model id is an admin-tunable layered-config value (agent.modelId, §7) — its
    // default mirrors the AGENT_MODEL env value, so behaviour is unchanged without
    // a DB override. The ANTHROPIC_API_KEY remains a secret, read from env above.
    const modelId = this.effectiveConfig.get<string>('agent.modelId');

    const model = new ChatAnthropic({ apiKey, model: modelId });
    this.model = model;
    return model;
  }
}
