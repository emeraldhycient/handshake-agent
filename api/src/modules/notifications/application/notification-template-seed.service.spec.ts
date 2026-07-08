import { DEFAULT_NOTIFICATION_TEMPLATES } from './default-notification-templates';
import { NotificationTemplateSeedService } from './notification-template-seed.service';
import type { INotificationTemplateRepository } from './ports/notification-template.repository.port';

describe('NotificationTemplateSeedService', () => {
  function makeRepo(): jest.Mocked<INotificationTemplateRepository> {
    return {
      list: jest.fn(),
      find: jest.fn(),
      existsByKey: jest.fn(),
      upsert: jest.fn(),
      seedDefaults: jest.fn().mockResolvedValue(0),
    };
  }

  it('forwards the committed platform defaults to the repo seed', async () => {
    const repo = makeRepo();
    const svc = new NotificationTemplateSeedService(repo);

    await svc.seedDefaults();

    expect(repo.seedDefaults).toHaveBeenCalledTimes(1);
    const [rows] = repo.seedDefaults.mock.calls[0];
    // Every committed default is forwarded, projected to the seed shape (no adminId).
    expect(rows).toHaveLength(DEFAULT_NOTIFICATION_TEMPLATES.length);
    expect(rows[0]).toEqual({
      templateKey: DEFAULT_NOTIFICATION_TEMPLATES[0].templateKey,
      language: DEFAULT_NOTIFICATION_TEMPLATES[0].language,
      channel: DEFAULT_NOTIFICATION_TEMPLATES[0].channel,
      contentText: DEFAULT_NOTIFICATION_TEMPLATES[0].contentText,
      variables: DEFAULT_NOTIFICATION_TEMPLATES[0].variables,
    });
    expect(rows[0]).not.toHaveProperty('updatedByAdminId');
  });

  it('is idempotent — a re-run inserts nothing (repo skips existing keys)', async () => {
    const repo = makeRepo();
    repo.seedDefaults.mockResolvedValueOnce(
      DEFAULT_NOTIFICATION_TEMPLATES.length,
    );
    repo.seedDefaults.mockResolvedValueOnce(0);
    const svc = new NotificationTemplateSeedService(repo);

    const first = await svc.seedDefaults();
    const second = await svc.seedDefaults();

    expect(first).toBe(DEFAULT_NOTIFICATION_TEMPLATES.length);
    expect(second).toBe(0);
  });
});

describe('DEFAULT_NOTIFICATION_TEMPLATES', () => {
  it('keys every default to a real NotificationEventType value', () => {
    // The enum values the schema (09-notifications.prisma) declares.
    const eventTypes = new Set([
      'transaction_pending',
      'transaction_completed',
      'transaction_failed',
      'kyc_approved',
      'kyc_rejected',
      'kyc_pending_review',
      'compliance_flag',
      'compliance_resolved',
      'receipt_ready',
      'balance_update',
      'beneficiary_added',
      'beneficiary_verified',
      'ticket_delivered',
      'refund_issued',
      'refund_pending',
      'deposit_confirmed',
      'withdrawal_initiated',
      'pin_reset_initiated',
      'device_added',
      'suspicious_activity_alert',
      'broadcast',
    ]);
    for (const t of DEFAULT_NOTIFICATION_TEMPLATES) {
      expect(eventTypes.has(t.templateKey)).toBe(true);
    }
  });

  it('has a unique (templateKey, language, channel) per row', () => {
    const keys = DEFAULT_NOTIFICATION_TEMPLATES.map(
      (t) => `${t.templateKey}:${t.language}:${t.channel}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every body substitutes only variables it documents', () => {
    const placeholder = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    for (const t of DEFAULT_NOTIFICATION_TEMPLATES) {
      const declared = new Set(t.variables.map((v) => v.name));
      for (const m of t.contentText.matchAll(placeholder)) {
        expect(declared.has(m[1])).toBe(true);
      }
    }
  });
});
