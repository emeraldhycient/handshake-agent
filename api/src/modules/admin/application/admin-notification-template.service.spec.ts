import { AdminNotificationTemplateService } from './admin-notification-template.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type {
  INotificationTemplateRepository,
  NotificationTemplateRecord,
  UpsertNotificationTemplateInput,
} from '../../notifications/application/ports/notification-template.repository.port';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';

// ── Test doubles ─────────────────────────────────────────────────────────────

interface RepoState {
  rows: NotificationTemplateRecord[];
  upserts: UpsertNotificationTemplateInput[];
}

function record(
  overrides: Partial<NotificationTemplateRecord> & { templateKey: string },
): NotificationTemplateRecord {
  return {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    language: 'en',
    channel: 'whatsapp',
    subject: null,
    contentText: 'Hi {{name}}',
    contentHtml: null,
    whatsappTemplateId: null,
    variables: [],
    ...overrides,
  };
}

function makeRepo(rows: NotificationTemplateRecord[] = []): {
  repo: INotificationTemplateRepository;
  state: RepoState;
} {
  const state: RepoState = { rows, upserts: [] };
  const repo: INotificationTemplateRepository = {
    list: () => Promise.resolve(state.rows),
    existsByKey: (templateKey) =>
      Promise.resolve(state.rows.some((r) => r.templateKey === templateKey)),
    find: (templateKey, language, channel) =>
      Promise.resolve(
        state.rows.find(
          (r) =>
            r.templateKey === templateKey &&
            r.language === language &&
            r.channel === channel,
        ) ?? null,
      ),
    upsert(input): Promise<NotificationTemplateRecord> {
      state.upserts.push(input);
      const row = record({
        id: 'upserted-id',
        templateKey: input.templateKey,
        language: input.language,
        channel: input.channel,
        subject: input.subject ?? null,
        contentText: input.contentText,
        contentHtml: input.contentHtml ?? null,
        whatsappTemplateId: input.whatsappTemplateId ?? null,
        variables: input.variables,
      });
      return Promise.resolve(row);
    },
    seedDefaults: () => Promise.resolve(0),
  };
  return { repo, state };
}

function makeAudit(): { audit: AuditService; calls: RecordAuditInput[] } {
  const calls: RecordAuditInput[] = [];
  const audit = {
    record(input: RecordAuditInput): Promise<void> {
      calls.push(input);
      return Promise.resolve();
    },
  } as unknown as AuditService;
  return { audit, calls };
}

describe('AdminNotificationTemplateService', () => {
  describe('list', () => {
    it('maps every repository record through the contract shape', async () => {
      const { repo } = makeRepo([
        record({
          templateKey: 'transaction.completed',
          variables: [{ name: 'name', type: 'string', description: 'User.' }],
        }),
      ]);
      const { audit } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      const result = await svc.list();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].templateKey).toBe('transaction.completed');
      expect(result.items[0].variables).toEqual([
        { name: 'name', type: 'string', description: 'User.' },
      ]);
    });

    it('coerces a non-array variables JSON column to an empty array', async () => {
      const { repo } = makeRepo([
        record({ templateKey: 'k', variables: null }),
      ]);
      const { audit } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      const result = await svc.list();
      expect(result.items[0].variables).toEqual([]);
    });
  });

  describe('get', () => {
    it('returns a mapped template for a known composite key', async () => {
      const { repo } = makeRepo([
        record({
          templateKey: 'kyc.approved',
          language: 'en',
          channel: 'email',
        }),
      ]);
      const { audit } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      const got = await svc.get('kyc.approved', 'en', 'email');
      expect(got.templateKey).toBe('kyc.approved');
      expect(got.channel).toBe('email');
    });

    it('throws AdminNotFoundError when the template is absent', async () => {
      const { repo } = makeRepo();
      const { audit } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      await expect(svc.get('missing', 'en', 'whatsapp')).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });

  describe('upsert', () => {
    it('persists the input, audits config_change, and returns the mapped row', async () => {
      const existing = record({
        templateKey: 'transaction.completed',
        language: 'en',
        channel: 'whatsapp',
        contentText: 'Old text',
      });
      const { repo, state } = makeRepo([existing]);
      const { audit, calls } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      const result = await svc.upsert(
        {
          templateKey: 'transaction.completed',
          language: 'en',
          channel: 'whatsapp',
          contentText: 'New text {{name}}',
          variables: [],
        },
        'admin-1',
      );

      expect(state.upserts).toHaveLength(1);
      expect(state.upserts[0]).toEqual({
        templateKey: 'transaction.completed',
        language: 'en',
        channel: 'whatsapp',
        contentText: 'New text {{name}}',
        variables: [],
        updatedByAdminId: 'admin-1',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('config_change');
      expect(calls[0].subject).toBe(
        'NotificationTemplate:transaction.completed:en:whatsapp',
      );
      expect(calls[0].actorAdminId).toBe('admin-1');
      // before = the existing row's content, after = the new input.
      expect((calls[0].before as { contentText?: string }).contentText).toBe(
        'Old text',
      );
      expect((calls[0].after as { contentText?: string }).contentText).toBe(
        'New text {{name}}',
      );
      expect(result.contentText).toBe('New text {{name}}');
    });

    it('audits a null before when creating a brand-new template', async () => {
      const { repo, state } = makeRepo();
      const { audit, calls } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      await svc.upsert(
        {
          templateKey: 'new.template',
          language: 'en',
          channel: 'sms',
          contentText: 'Brand new',
          variables: [],
        },
        'admin-9',
      );

      expect(state.upserts).toHaveLength(1);
      expect(calls[0].before).toBeNull();
    });
  });

  describe('preview', () => {
    it('renders contentText with the supplied variables, subject null when absent', () => {
      const { repo } = makeRepo();
      const { audit } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      const out = svc.preview({
        contentText: 'Hi {{name}}',
        variables: { name: 'Ada' },
      });
      expect(out.renderedText).toBe('Hi Ada');
      expect(out.renderedSubject).toBeNull();
    });

    it('renders the subject too when one is supplied', () => {
      const { repo } = makeRepo();
      const { audit } = makeAudit();
      const svc = new AdminNotificationTemplateService(repo, audit);

      const out = svc.preview({
        contentText: 'Body for {{name}}',
        subject: 'Welcome {{name}}',
        variables: { name: 'Ada' },
      });
      expect(out.renderedSubject).toBe('Welcome Ada');
      expect(out.renderedText).toBe('Body for Ada');
    });
  });
});
