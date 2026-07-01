import { runAgent } from './agent.graph';
import type { ConversationTurn, LlmProvider } from './ports/llm-provider.port';
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

  it('threads conversation history into the LlmProvider so a follow-up resolves in context', async () => {
    // Prior turn: the assistant asked "How much USDT?"; the user now replies "50k".
    const history: ConversationTurn[] = [
      { role: 'user', content: 'buy usdt' },
      { role: 'assistant', content: 'How much USDT would you like to buy?' },
    ];
    const resolved: Intent = {
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '50000',
      fiatCurrency: 'NGN',
    };
    const llm = makeFake(resolved);

    const result = await runAgent({ userText: '50k', llm, history });

    expect(result).toEqual(resolved);
    // The history must reach the provider verbatim so the model can use it.
    expect(llm.extractIntent).toHaveBeenCalledWith('50k', history);
  });

  it('passes an empty history through unchanged when none is supplied', async () => {
    const intent: Intent = {
      action: 'none',
      clarification: 'What would you like to do?',
    };
    const llm = makeFake(intent);

    await runAgent({ userText: 'hi', llm });

    // No history supplied → provider is called with undefined/empty history.
    expect(llm.extractIntent).toHaveBeenCalledWith('hi', []);
  });
});
