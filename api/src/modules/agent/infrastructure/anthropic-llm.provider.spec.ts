/**
 * Unit tests for AnthropicLlmProvider.
 *
 * Strategy: `jest.mock('@langchain/anthropic')` replaces the entire module so
 * no network call is ever made. We assert that:
 *   1. With a valid key, `extractIntent` lazily constructs ChatAnthropic,
 *      chains `withStructuredOutput(IntentSchema, ...)`, invokes the model
 *      with the correct messages, and returns the mocked intent.
 *   2. With an empty (missing) key, `extractIntent` throws an error matching
 *      `/ANTHROPIC_API_KEY/`.
 *   3. `buildSystemPrompt()` renders enabled assets and default fiat from the
 *      AssetRegistry — no hardcoded basket.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Intent } from '@handshake-agent/contracts';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

// ---------------------------------------------------------------------------
// Mock @langchain/anthropic BEFORE importing the module under test.
// ---------------------------------------------------------------------------

const mockInvoke = jest.fn();
const mockWithStructuredOutput = jest
  .fn()
  .mockReturnValue({ invoke: mockInvoke });
const mockChatAnthropicInstance = {
  withStructuredOutput: mockWithStructuredOutput,
};
const MockChatAnthropic = jest
  .fn()
  .mockImplementation(() => mockChatAnthropicInstance);

jest.mock('@langchain/anthropic', () => ({
  ChatAnthropic: MockChatAnthropic,
}));

// Import the SUT after the mock is set up.
import { AnthropicLlmProvider } from './anthropic-llm.provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cannedIntent: Intent = {
  action: 'buy_crypto',
  asset: 'USDT',
  fiatAmount: '5000',
  fiatCurrency: 'NGN',
};

function makeConfigService(apiKey: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return apiKey;
      return undefined;
    }),
  } as unknown as ConfigService;
}

/**
 * EffectiveConfigService stub: the model id now resolves from the layered config
 * (`agent.modelId`), not from ConfigService('AGENT_MODEL'). Default mirrors the
 * env default so behaviour is unchanged with no DB override.
 */
function makeEffectiveConfig(
  model = 'claude-opus-4-8',
): EffectiveConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'agent.modelId') return model;
      return undefined;
    }),
  } as unknown as EffectiveConfigService;
}

/** Minimal AssetRegistry stub backed by a catalog with USDT + NGN. */
function makeAssetRegistry(): AssetRegistry {
  return {
    defaultFiat: jest.fn().mockReturnValue('NGN'),
    enabledCryptoAssets: jest.fn().mockReturnValue(['USDT']),
    enabledFiats: jest.fn().mockReturnValue(['NGN']),
  } as unknown as AssetRegistry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicLlmProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockChatAnthropic.mockImplementation(() => mockChatAnthropicInstance);
    mockWithStructuredOutput.mockReturnValue({ invoke: mockInvoke });
    // The structured tool now wraps the intent union in an object
    // ({ intent }) so the Anthropic tool input_schema has a root object type;
    // the provider unwraps `.intent`.
    mockInvoke.mockResolvedValue({ intent: cannedIntent });
  });

  describe('when ANTHROPIC_API_KEY is provided', () => {
    let provider: AnthropicLlmProvider;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AnthropicLlmProvider,
          {
            provide: ConfigService,
            useValue: makeConfigService('sk-ant-test-key'),
          },
          {
            provide: AssetRegistry,
            useValue: makeAssetRegistry(),
          },
          {
            provide: EffectiveConfigService,
            useValue: makeEffectiveConfig(),
          },
        ],
      }).compile();

      provider = module.get(AnthropicLlmProvider);
    });

    it('is defined', () => {
      expect(provider).toBeDefined();
    });

    it('does NOT construct ChatAnthropic in the constructor (lazy)', () => {
      expect(MockChatAnthropic).not.toHaveBeenCalled();
    });

    it('constructs ChatAnthropic on first extractIntent call', async () => {
      await provider.extractIntent('buy 5000 naira of usdt');
      expect(MockChatAnthropic).toHaveBeenCalledTimes(1);
      expect(MockChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-ant-test-key',
          model: 'claude-opus-4-8',
        }),
      );
    });

    it('calls withStructuredOutput with the intent-wrapping schema and { name: "extract_intent" }', async () => {
      await provider.extractIntent('buy 5000 naira of usdt');
      // Anthropic tool input_schema must be a root object, so the union is
      // wrapped: z.object({ intent: IntentSchema }). Assert the wrapper shape
      // (has an `intent` key) + the tool name.
      const call = mockWithStructuredOutput.mock.calls[0] as unknown[];
      const schemaArg = call[0] as { shape?: Record<string, unknown> };
      expect(schemaArg.shape).toHaveProperty('intent');
      expect(call[1]).toEqual({ name: 'extract_intent' });
    });

    it('invokes the structured model with system + user messages', async () => {
      await provider.extractIntent('buy 5000 naira of usdt');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      // mock.calls entries are typed `any[]` by Jest — cast once at the boundary.
      const firstCall = mockInvoke.mock.calls[0] as unknown[][];
      const [messages] = firstCall;
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({
            role: 'user',
            content: 'buy 5000 naira of usdt',
          }),
        ]),
      );
    });

    it('threads prior conversation turns between the system and current-user messages', async () => {
      const history = [
        { role: 'user' as const, content: 'buy usdt' },
        {
          role: 'assistant' as const,
          content: 'How much USDT would you like to buy?',
        },
      ];
      await provider.extractIntent('50000', history);

      const firstCall = mockInvoke.mock.calls[0] as unknown[][];
      const [messages] = firstCall as [
        Array<{ role: string; content: string }>,
      ];

      // Order matters: system, then each history turn in order, then the new user message last.
      expect(messages[0]).toEqual(expect.objectContaining({ role: 'system' }));
      expect(messages[1]).toEqual({ role: 'user', content: 'buy usdt' });
      expect(messages[2]).toEqual({
        role: 'assistant',
        content: 'How much USDT would you like to buy?',
      });
      expect(messages[messages.length - 1]).toEqual({
        role: 'user',
        content: '50000',
      });
    });

    it('works with no history (single-turn) — only system + user', async () => {
      await provider.extractIntent('buy 5000 naira of usdt');
      const firstCall = mockInvoke.mock.calls[0] as unknown[][];
      const [messages] = firstCall as [Array<{ role: string }>];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual(expect.objectContaining({ role: 'system' }));
      expect(messages[1]).toEqual(expect.objectContaining({ role: 'user' }));
    });

    it('returns the intent returned by the model', async () => {
      const result = await provider.extractIntent('buy 5000 naira of usdt');
      expect(result).toEqual(cannedIntent);
    });

    describe('deterministic amount normalization backstop', () => {
      it('strips a ₦ symbol and thousands-commas from fiatAmount before returning', async () => {
        mockInvoke.mockResolvedValueOnce({
          intent: {
            action: 'buy_crypto',
            asset: 'USDT',
            fiatAmount: '₦50,000',
            fiatCurrency: 'NGN',
          },
        });

        const result = await provider.extractIntent('buy ₦50,000 of usdt');

        // The model emitted a non-schema-valid amount; the backstop normalizes
        // it to a bare decimal so IntentSchema accepts it — no "assistant
        // unavailable" for a parseable amount.
        expect(result).toEqual({
          action: 'buy_crypto',
          asset: 'USDT',
          fiatAmount: '50000',
          fiatCurrency: 'NGN',
        });
      });

      it('strips commas and a $ sign and trims spaces from a sell fiatAmount', async () => {
        mockInvoke.mockResolvedValueOnce({
          intent: {
            action: 'sell_crypto',
            asset: 'USDT',
            fiatAmount: ' $1,234.50 ',
            fiatCurrency: 'NGN',
          },
        });

        const result = await provider.extractIntent('sell $1,234.50 of usdt');

        expect((result as { fiatAmount: string }).fiatAmount).toBe('1234.50');
      });

      it('normalizes a send cryptoAmount with grouping separators', async () => {
        mockInvoke.mockResolvedValueOnce({
          intent: {
            action: 'send_crypto',
            asset: 'USDT',
            cryptoAmount: '1,000.25',
            network: 'TRON',
          },
        });

        const result = await provider.extractIntent('send 1,000.25 usdt');

        expect((result as { cryptoAmount: string }).cryptoAmount).toBe(
          '1000.25',
        );
      });

      it('normalizes a swap amount with separators', async () => {
        mockInvoke.mockResolvedValueOnce({
          intent: {
            action: 'swap',
            fromAsset: 'USDT',
            toAsset: 'TRX',
            amount: '2,500',
          },
        });

        const result = await provider.extractIntent('swap 2,500 usdt for trx');

        expect((result as { amount: string }).amount).toBe('2500');
      });

      it('leaves an already-clean amount untouched', async () => {
        mockInvoke.mockResolvedValueOnce({
          intent: {
            action: 'buy_crypto',
            asset: 'USDT',
            fiatAmount: '5000',
            fiatCurrency: 'NGN',
          },
        });

        const result = await provider.extractIntent('buy 5000 usdt');
        expect((result as { fiatAmount: string }).fiatAmount).toBe('5000');
      });

      it('does not touch intents without an amount field (none/receive)', async () => {
        mockInvoke.mockResolvedValueOnce({
          intent: { action: 'none', clarification: 'What would you like?' },
        });

        const result = await provider.extractIntent('hmm');
        expect(result).toEqual({
          action: 'none',
          clarification: 'What would you like?',
        });
      });
    });

    it('reuses the cached ChatAnthropic instance across multiple calls', async () => {
      await provider.extractIntent('first call');
      await provider.extractIntent('second call');
      expect(MockChatAnthropic).toHaveBeenCalledTimes(1);
    });

    it('reads the model id from EffectiveConfigService (agent.modelId), not ConfigService', async () => {
      // The model id is now a layered-config value (admin-tunable, §7). An admin
      // override of `agent.modelId` must change which model ChatAnthropic builds,
      // while the ANTHROPIC_API_KEY still comes from env via ConfigService.
      const overridden = new AnthropicLlmProvider(
        makeConfigService('sk-ant-test-key') as unknown as ConfigService<
          import('../../../core/config/env.schema').Env,
          true
        >,
        makeAssetRegistry(),
        makeEffectiveConfig('claude-sonnet-override'),
      );
      await overridden.extractIntent('buy 5000 naira of usdt');
      expect(MockChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-ant-test-key',
          model: 'claude-sonnet-override',
        }),
      );
    });

    describe('buildSystemPrompt()', () => {
      it('contains the catalog-enabled crypto asset (USDT)', () => {
        const prompt = provider.buildSystemPrompt();
        expect(prompt).toContain('USDT');
      });

      it('contains the default fiat from the registry (NGN)', () => {
        const prompt = provider.buildSystemPrompt();
        expect(prompt).toContain('NGN');
      });

      it('does NOT contain the old hardcoded asset basket line', () => {
        const prompt = provider.buildSystemPrompt();
        expect(prompt).not.toContain('Only "USDT" and "BTC"');
      });

      it('documents the query_transactions action and the no-date-math rule', () => {
        const prompt = provider.buildSystemPrompt();
        expect(prompt).toContain('query_transactions');
        expect(prompt).toMatch(/never compute (calendar )?dates/i);
        expect(prompt).toContain('download');
      });

      it('documents the relative-duration spec for flexible ranges (sub-day → year)', () => {
        const prompt = provider.buildSystemPrompt();
        // The relative-spec field names the model must emit.
        expect(prompt).toContain('relativeAmount');
        expect(prompt).toContain('relativeUnit');
        // The unit vocabulary spans sub-day through year.
        expect(prompt).toMatch(/minute/);
        expect(prompt).toMatch(/hour/);
        expect(prompt).toMatch(/week|month|year/);
        // At least one worked example so the model maps NL → spec.
        expect(prompt).toMatch(/last 2 weeks|6 months|24 hours|an hour ago/i);
      });

      it('instructs the model to set the optional asset on check_balance', () => {
        const prompt = provider.buildSystemPrompt();
        // The check_balance bullet must explain the optional asset so that
        // "my USDT balance" → { action: 'check_balance', asset: 'USDT' } and a
        // bare "what's my balance" → { action: 'check_balance' }.
        expect(prompt).toContain('check_balance: user wants to check');
        expect(prompt).toContain('set "asset"');
      });

      it('lists the currently live/enabled fiats from the registry', () => {
        // The prompt must name the enabled fiats so the model knows what can
        // settle today (NGN only at launch).
        const prompt = provider.buildSystemPrompt();
        expect(prompt).toContain('NGN');
        // enabledFiats() was called — confirms dynamic rendering (no hardcoded value).
        const registry = makeAssetRegistry();
        // Cast through unknown: ConfigService mock satisfies the shape but the generic
        // param `true` cannot be inferred from a plain object mock — the cast is safe
        // here because we are only asserting on `registry.enabledFiats` being called.
        new AnthropicLlmProvider(
          makeConfigService(
            'sk-test',
          ) as unknown as import('@nestjs/config').ConfigService<
            import('../../../core/config/env.schema').Env,
            true
          >,
          registry,
          makeEffectiveConfig(),
        ).buildSystemPrompt();
        expect(registry.enabledFiats).toHaveBeenCalled();
      });

      it('instructs the model to extract any supported fiat (not only enabled ones)', () => {
        // The model must pass-through whatever fiat the user names — the ENGINE
        // decides liveness, not the model. The prompt must not tell the model to
        // reject or refuse non-NGN fiats.
        const prompt = provider.buildSystemPrompt();
        expect(prompt).not.toMatch(/only (accept|use|support|NGN)/i);
        expect(prompt).toMatch(/extract.*fiat|fiat.*extract/i);
      });

      it('instructs the model to normalize currency symbols and thousands separators in amounts', () => {
        // ₦50,000 / $1,234.50 must become bare decimal strings (finding: amount mis-parse).
        const prompt = provider.buildSystemPrompt();
        // Mentions the symbols/separators it must strip and the canonical example.
        expect(prompt).toMatch(/strip|remove/i);
        expect(prompt).toContain('₦');
        expect(prompt).toMatch(/thousands|separator|comma/i);
        expect(prompt).toContain('50000');
      });

      it('instructs the model to ask a clarifying question when an action is known but the amount is missing', () => {
        // "buy USDT" / "send some money" → action:'none' + clarification, never a thrown intent.
        const prompt = provider.buildSystemPrompt();
        expect(prompt).toMatch(/missing|omit|not specif|without/i);
        expect(prompt).toMatch(/clarif|how much|ask/i);
        // It must tell the model to use "none" (not emit a buy/send with no amount).
        expect(prompt).toMatch(/action.*none|"none"/i);
      });

      it('instructs the model to surface multiple intents instead of silently dropping one', () => {
        // "buy 5k usdt and send 20 to John" → none + a clarification naming both.
        const prompt = provider.buildSystemPrompt();
        expect(prompt).toMatch(/two|multiple|more than one|2\+/i);
        expect(prompt).toMatch(/none/);
      });

      it('instructs the model to handle non-English (Pidgin/Hausa/Yoruba/Igbo) and reply in the user language', () => {
        const prompt = provider.buildSystemPrompt();
        // Names the supported Nigerian languages so the model engages them.
        expect(prompt).toMatch(/pidgin/i);
        expect(prompt).toMatch(/hausa/i);
        expect(prompt).toMatch(/yoruba/i);
        expect(prompt).toMatch(/igbo/i);
        // Reply-in-language rule.
        expect(prompt).toMatch(/user'?s language|same language|reply in/i);
      });

      it('instructs a low-confidence non-English amount/action to fall back to a clarifying question', () => {
        const prompt = provider.buildSystemPrompt();
        // The funds-safety guard: when unsure about a non-English amount/action, prefer none.
        expect(prompt).toMatch(
          /not confident|unsure|uncertain|low confidence/i,
        );
        expect(prompt).toMatch(/none|clarif/i);
      });

      it('lists ALL discovered assets (USDT + TRX) when the registry returns both', () => {
        // When CatalogSyncService discovers TRX alongside USDT, enabledCryptoAssets()
        // returns both. The system prompt MUST enumerate all of them so the model
        // recognises user requests for either asset.
        const registry = {
          defaultFiat: jest.fn().mockReturnValue('NGN'),
          enabledCryptoAssets: jest.fn().mockReturnValue(['USDT', 'TRX']),
          enabledFiats: jest.fn().mockReturnValue(['NGN']),
        } as unknown as AssetRegistry;

        const multiAssetProvider = new AnthropicLlmProvider(
          makeConfigService(
            'sk-test',
          ) as unknown as import('@nestjs/config').ConfigService<
            import('../../../core/config/env.schema').Env,
            true
          >,
          registry,
          makeEffectiveConfig(),
        );

        const prompt = multiAssetProvider.buildSystemPrompt();

        // Both assets must appear in the prompt asset list.
        expect(prompt).toContain('"USDT"');
        expect(prompt).toContain('"TRX"');
        // The rule line must reference the full discovered set.
        expect(prompt).toMatch(/"USDT".*"TRX"|"TRX".*"USDT"/);
        // enabledCryptoAssets() must be called — confirms dynamic rendering.
        expect(registry.enabledCryptoAssets).toHaveBeenCalled();
      });
    });
  });

  describe('when ANTHROPIC_API_KEY is empty / not set', () => {
    let provider: AnthropicLlmProvider;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AnthropicLlmProvider,
          {
            provide: ConfigService,
            useValue: makeConfigService(undefined),
          },
          {
            provide: AssetRegistry,
            useValue: makeAssetRegistry(),
          },
          {
            provide: EffectiveConfigService,
            useValue: makeEffectiveConfig(),
          },
        ],
      }).compile();

      provider = module.get(AnthropicLlmProvider);
    });

    it('throws a clear error mentioning ANTHROPIC_API_KEY', async () => {
      await expect(provider.extractIntent('buy something')).rejects.toThrow(
        /ANTHROPIC_API_KEY/,
      );
    });

    it('does NOT call ChatAnthropic when the key is absent', async () => {
      await expect(provider.extractIntent('buy something')).rejects.toThrow();
      expect(MockChatAnthropic).not.toHaveBeenCalled();
    });
  });
});
