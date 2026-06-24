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
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Intent } from '@handshake-agent/contracts';
import { IntentSchema } from '@handshake-agent/contracts';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicLlmProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockChatAnthropic.mockImplementation(() => mockChatAnthropicInstance);
    mockWithStructuredOutput.mockReturnValue({ invoke: mockInvoke });
    mockInvoke.mockResolvedValue(cannedIntent);
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

    it('calls withStructuredOutput(IntentSchema, { name: "extract_intent" })', async () => {
      await provider.extractIntent('buy 5000 naira of usdt');
      expect(mockWithStructuredOutput).toHaveBeenCalledWith(IntentSchema, {
        name: 'extract_intent',
      });
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
