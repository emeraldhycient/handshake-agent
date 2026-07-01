import { Test, TestingModule } from '@nestjs/testing';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminAgentService } from './admin-agent.service';
import {
  CONVERSATION_LOG_READ_REPOSITORY,
  type ConversationLogDetailRecord,
  type ConversationLogRecord,
  type IConversationLogReadRepository,
} from '../../conversations/application/ports/conversation-log-read.repository.port';

const conversationRecord: ConversationLogRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  contactId: null,
  language: 'en',
  status: 'active',
  lastMessageAt: new Date('2026-06-30T01:00:00.000Z'),
  createdAt: new Date('2026-06-30T00:00:00.000Z'),
};

const detailRecord: ConversationLogDetailRecord = {
  conversation: conversationRecord,
  messages: [
    {
      id: '44444444-4444-4444-4444-444444444444',
      text: 'buy 5000 naira of usdt',
      processingStatus: 'processed',
      receivedAt: new Date('2026-06-30T00:00:00.000Z'),
      intent: { action: 'buy_crypto', confidence: 0.91 },
    },
    {
      id: '66666666-6666-6666-6666-666666666666',
      text: 'hi',
      processingStatus: 'received',
      receivedAt: new Date('2026-06-30T00:01:00.000Z'),
      intent: null,
    },
  ],
  replies: [
    {
      id: '55555555-5555-5555-5555-555555555555',
      text: 'Here is your quote',
      status: 'sent',
      sentAt: new Date('2026-06-30T00:00:30.000Z'),
    },
  ],
};

describe('AdminAgentService', () => {
  let service: AdminAgentService;
  let repo: jest.Mocked<IConversationLogReadRepository>;
  let effectiveConfig: jest.Mocked<Pick<EffectiveConfigService, 'get'>>;

  beforeEach(async () => {
    repo = { listAll: jest.fn(), loadConversationLog: jest.fn() };
    effectiveConfig = {
      get: jest.fn((key: string) => {
        if (key === 'agent.modelId') return 'claude-opus-4-8';
        if (key === 'agent.enabled') return true;
        return undefined;
      }) as jest.Mock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAgentService,
        { provide: CONVERSATION_LOG_READ_REPOSITORY, useValue: repo },
        { provide: EffectiveConfigService, useValue: effectiveConfig },
      ],
    }).compile();
    service = module.get(AdminAgentService);
  });

  describe('getConfig', () => {
    it('returns the model id + enablement from the layered config and a prompt preview', () => {
      const view = service.getConfig();
      expect(view.modelId).toBe('claude-opus-4-8');
      expect(view.enabled).toBe(true);
      expect(view.systemPromptPreview.length).toBeGreaterThan(0);
    });

    it('NEVER includes the ANTHROPIC_API_KEY anywhere in the view', () => {
      effectiveConfig.get.mockImplementation((key: string) => {
        if (key === 'agent.modelId') return 'claude-opus-4-8';
        if (key === 'agent.enabled') return false;
        return undefined;
      });
      const view = service.getConfig();
      const serialized = JSON.stringify(view).toLowerCase();
      expect(serialized).not.toContain('anthropic_api_key');
      expect(serialized).not.toContain('sk-ant');
      expect(serialized).not.toContain('api_key');
      // enablement flows through from the config.
      expect(view.enabled).toBe(false);
    });
  });

  describe('listConversations', () => {
    it('maps records to contract items and stringifies dates', async () => {
      repo.listAll.mockResolvedValue({
        items: [conversationRecord],
        nextCursor: null,
      });
      const result = await service.listConversations({});
      expect(result.items).toEqual([
        {
          id: conversationRecord.id,
          userId: conversationRecord.userId,
          contactId: null,
          language: 'en',
          status: 'active',
          lastMessageAt: '2026-06-30T01:00:00.000Z',
          createdAt: '2026-06-30T00:00:00.000Z',
        },
      ]);
      expect(result.nextCursor).toBeNull();
    });

    it('maps a null lastMessageAt to null', async () => {
      repo.listAll.mockResolvedValue({
        items: [{ ...conversationRecord, lastMessageAt: null }],
        nextCursor: 'cur',
      });
      const result = await service.listConversations({ cursor: 'x', limit: 5 });
      expect(repo.listAll).toHaveBeenCalledWith({ cursor: 'x', limit: 5 });
      expect(result.items[0].lastMessageAt).toBeNull();
      expect(result.nextCursor).toBe('cur');
    });
  });

  describe('getConversation', () => {
    it('returns the detail aggregate (messages + intents + replies)', async () => {
      repo.loadConversationLog.mockResolvedValue(detailRecord);
      const detail = await service.getConversation(conversationRecord.id);

      expect(detail.id).toBe(conversationRecord.id);
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[0].intent).toEqual({
        action: 'buy_crypto',
        confidence: 0.91,
      });
      expect(detail.messages[1].intent).toBeNull();
      expect(detail.messages[0].receivedAt).toBe('2026-06-30T00:00:00.000Z');
      expect(detail.replies).toHaveLength(1);
      expect(detail.replies[0].sentAt).toBe('2026-06-30T00:00:30.000Z');
    });

    it('throws AdminNotFoundError when the conversation is missing', async () => {
      repo.loadConversationLog.mockResolvedValue(null);
      await expect(service.getConversation('missing')).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });
});
