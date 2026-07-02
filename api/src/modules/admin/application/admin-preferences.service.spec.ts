import { AdminPreferencesService } from './admin-preferences.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  AdminPreferencesRecord,
  IAdminPreferencesRepository,
} from './ports/admin-preferences.repository.port';

const ALL_TRUE: AdminPreferencesRecord = {
  emailAlerts: true,
  approvalMentions: true,
  weeklyDigest: true,
};

function makeRepo(stored?: AdminPreferencesRecord | null): {
  repo: IAdminPreferencesRepository;
  getCalls: string[];
  upsertCalls: { adminId: string; prefs: AdminPreferencesRecord }[];
} {
  const getCalls: string[] = [];
  const upsertCalls: { adminId: string; prefs: AdminPreferencesRecord }[] = [];
  const repo: IAdminPreferencesRepository = {
    get(adminId: string): Promise<AdminPreferencesRecord | null> {
      getCalls.push(adminId);
      return Promise.resolve(stored === undefined ? null : stored);
    },
    upsert(
      adminId: string,
      prefs: AdminPreferencesRecord,
    ): Promise<AdminPreferencesRecord> {
      upsertCalls.push({ adminId, prefs });
      return Promise.resolve(prefs);
    },
  };
  return { repo, getCalls, upsertCalls };
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

describe('AdminPreferencesService', () => {
  describe('get', () => {
    it('returns the persisted preferences when a row exists', async () => {
      const stored: AdminPreferencesRecord = {
        emailAlerts: false,
        approvalMentions: true,
        weeklyDigest: false,
      };
      const { repo, getCalls } = makeRepo(stored);
      const { audit } = makeAudit();

      const svc = new AdminPreferencesService(repo, audit);
      const result = await svc.get('admin-1');

      expect(result).toEqual(stored);
      expect(getCalls).toEqual(['admin-1']);
    });

    it('falls back to all-true defaults when no row exists', async () => {
      const { repo } = makeRepo(null);
      const { audit } = makeAudit();

      const svc = new AdminPreferencesService(repo, audit);
      const result = await svc.get('admin-1');

      expect(result).toEqual(ALL_TRUE);
    });

    it('does not audit a read', async () => {
      const { repo } = makeRepo(null);
      const { audit, calls } = makeAudit();

      await new AdminPreferencesService(repo, audit).get('admin-1');

      expect(calls).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('upserts the caller-scoped row and returns the persisted state', async () => {
      const { repo, upsertCalls } = makeRepo(ALL_TRUE);
      const { audit } = makeAudit();
      const next: AdminPreferencesRecord = {
        emailAlerts: false,
        approvalMentions: true,
        weeklyDigest: false,
      };

      const result = await new AdminPreferencesService(repo, audit).update(
        'admin-1',
        next,
      );

      expect(result).toEqual(next);
      expect(upsertCalls).toEqual([{ adminId: 'admin-1', prefs: next }]);
    });

    it('audits an admin_update against the caller as subject with before/after', async () => {
      const before: AdminPreferencesRecord = {
        emailAlerts: true,
        approvalMentions: true,
        weeklyDigest: true,
      };
      const { repo } = makeRepo(before);
      const { audit, calls } = makeAudit();
      const next: AdminPreferencesRecord = {
        emailAlerts: false,
        approvalMentions: false,
        weeklyDigest: false,
      };

      await new AdminPreferencesService(repo, audit).update('admin-7', next);

      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
      expect(calls[0].subject).toBe('Admin:admin-7');
      expect(calls[0].actorAdminId).toBe('admin-7');
      expect(calls[0].before).toEqual(before);
      expect(calls[0].after).toEqual(next);
    });

    it('audits the all-true default as the before-state when no row exists yet', async () => {
      const { repo } = makeRepo(null);
      const { audit, calls } = makeAudit();
      const next: AdminPreferencesRecord = {
        emailAlerts: false,
        approvalMentions: true,
        weeklyDigest: true,
      };

      await new AdminPreferencesService(repo, audit).update('admin-9', next);

      expect(calls[0].before).toEqual(ALL_TRUE);
      expect(calls[0].after).toEqual(next);
    });
  });
});
