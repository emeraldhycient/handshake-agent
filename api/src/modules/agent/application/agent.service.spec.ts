import { Test, TestingModule } from '@nestjs/testing';
import type { Intent } from '@handshake-agent/contracts';
import type { LlmProvider } from '../core/ports/llm-provider.port';
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

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: LLM_PROVIDER, useValue: fakeLlmProvider },
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
    expect(fakeLlmProvider.extractIntent).toHaveBeenCalledWith(
      'buy 5000 naira of usdt',
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
});
