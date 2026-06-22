import { runAgent } from './agent.graph';
import type { LlmProvider } from './ports/llm-provider.port';
import type { Intent } from '@handshake-agent/contracts';

// ---------------------------------------------------------------------------
// Fake LlmProvider implementations — no network, no real model calls
// ---------------------------------------------------------------------------

function makeFake(returns: unknown): LlmProvider {
  return {
    extractIntent: jest.fn().mockResolvedValue(returns),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgent', () => {
  it('returns a BuyCryptoIntent when the LlmProvider resolves one', async () => {
    const expected: Intent = {
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    };

    const result = await runAgent({
      userText: 'I want to buy 5000 naira of USDT',
      llm: makeFake(expected),
    });

    expect(result).toEqual(expected);
  });

  it('returns a NoIntent when the LlmProvider resolves one', async () => {
    const expected: Intent = {
      action: 'none',
      clarification: 'Could you clarify what you would like to do?',
    };

    const result = await runAgent({
      userText: 'umm',
      llm: makeFake(expected),
    });

    expect(result).toEqual(expected);
  });

  it('throws a ZodError when the LlmProvider returns an invalid object (missing action)', async () => {
    // The IntentSchema.parse guard inside runAgent should fire and reject.
    const invalid = { asset: 'USDT', fiatAmount: '5000' }; // no `action`

    await expect(
      runAgent({ userText: 'buy stuff', llm: makeFake(invalid) }),
    ).rejects.toThrow();
  });
});
