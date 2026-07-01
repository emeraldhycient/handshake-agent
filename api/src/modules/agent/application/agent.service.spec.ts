import { Test, TestingModule } from '@nestjs/testing';
import type { Intent } from '@handshake-agent/contracts';
import type { LlmProvider } from '../core/ports/llm-provider.port';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AgentUnavailableError } from '../domain/agent-errors';
import { AgentService } from './agent.service';
import { LLM_PROVIDER } from './ports/agent.port';

const cannedIntent: Intent = {
  action: 'buy_crypto',
  asset: 'USDT',
  fiatAmount: '5000',
  fiatCurrency: 'NGN',
};

const fakeLlmProvider: LlmProvider = {
  extractIntent: jest.fn().mockResolvedValue(cannedIntent),
};

/**
 * EffectiveConfigService stub: the enablement gate reads `agent.enabled`. Default
 * true so the existing happy-path tests run unchanged; flip via `setEnabled`.
 */
let agentEnabled = true;
const fakeEffectiveConfig = {
  get: jest.fn((key: string) => {
    if (key === 'agent.enabled') return agentEnabled;
    return undefined;
  }),
} as unknown as EffectiveConfigService;

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(async () => {
    agentEnabled = true;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: LLM_PROVIDER, useValue: fakeLlmProvider },
        { provide: EffectiveConfigService, useValue: fakeEffectiveConfig },
      ],
    }).compile();

    service = module.get(AgentService);
    jest.clearAllMocks();
    (fakeLlmProvider.extractIntent as jest.Mock).mockResolvedValue(
      cannedIntent,
    );
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('delegates to runAgent via the injected LlmProvider and returns the intent', async () => {
    const result = await service.run('buy 5000 naira of usdt');

    expect(fakeLlmProvider.extractIntent).toHaveBeenCalledTimes(1);
    // The graph always threads history (defaulting to an empty list when the
    // caller supplies none), so the provider is called with (text, []).
    expect(fakeLlmProvider.extractIntent).toHaveBeenCalledWith(
      'buy 5000 naira of usdt',
      [],
    );
    expect(result).toEqual(cannedIntent);
  });

  it('propagates errors from the LlmProvider', async () => {
    const err = new Error('LLM unavailable');
    (fakeLlmProvider.extractIntent as jest.Mock).mockRejectedValueOnce(err);

    await expect(service.run('buy 5000 naira of usdt')).rejects.toThrow(
      'LLM unavailable',
    );
  });

  describe('enablement gate (agent.enabled, §3.1/§7)', () => {
    it('runs the agent when agent.enabled is true', async () => {
      agentEnabled = true;
      const result = await service.run('buy 5000 naira of usdt');
      expect(result).toEqual(cannedIntent);
      expect(fakeLlmProvider.extractIntent).toHaveBeenCalledTimes(1);
    });

    it('throws AgentUnavailableError BEFORE the LLM when agent.enabled is false', async () => {
      agentEnabled = false;
      await expect(
        service.run('buy 5000 naira of usdt'),
      ).rejects.toBeInstanceOf(AgentUnavailableError);
      // The gate must short-circuit BEFORE any LLM call (§3.1).
      expect(fakeLlmProvider.extractIntent).not.toHaveBeenCalled();
    });
  });

  it('forwards conversation history to the LlmProvider when supplied', async () => {
    const history = [
      { role: 'user' as const, content: 'buy usdt' },
      {
        role: 'assistant' as const,
        content: 'How much USDT would you like to buy?',
      },
    ];

    await service.run('50k', history);

    expect(fakeLlmProvider.extractIntent).toHaveBeenCalledWith('50k', history);
  });
});
