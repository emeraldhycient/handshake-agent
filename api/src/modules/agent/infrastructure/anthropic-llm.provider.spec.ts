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

function makeConfigService(
  apiKey: string | undefined,
  model = 'claude-opus-4-8',
): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return apiKey;
      if (key === 'AGENT_MODEL') return model;
      return undefined;
    }),
  } as unknown as ConfigService;
}

/** Minimal AssetRegistry stub backed by a catalog with USDT + NGN. */
function makeAssetRegistry(): AssetRegistry {
  return {
    defaultFiat: jest.fn().mockReturnValue('NGN'),
    enabledCryptoAssets: jest.fn().mockReturnValue(['USDT']),
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

    it('returns the intent returned by the model', async () => {
      const result = await provider.extractIntent('buy 5000 naira of usdt');
      expect(result).toEqual(cannedIntent);
    });

    it('reuses the cached ChatAnthropic instance across multiple calls', async () => {
      await provider.extractIntent('first call');
      await provider.extractIntent('second call');
      expect(MockChatAnthropic).toHaveBeenCalledTimes(1);
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
