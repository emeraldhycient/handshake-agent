import { AdminUserNoteService } from './admin-user-note.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  AdminUserNoteRecord,
  CreateAdminUserNoteInput,
  IAdminUserNoteRepository,
} from './ports/admin-user-note.repository.port';

function makeRecord(
  overrides: Partial<AdminUserNoteRecord> = {},
): AdminUserNoteRecord {
  return {
    id: 'note-1',
    userId: 'user-1',
    authorAdminId: 'admin-1',
    body: 'Called the user to confirm identity.',
    createdAt: new Date('2026-07-03T10:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(list: AdminUserNoteRecord[] = []): {
  repo: IAdminUserNoteRepository;
  createCalls: CreateAdminUserNoteInput[];
  listCalls: string[];
} {
  const createCalls: CreateAdminUserNoteInput[] = [];
  const listCalls: string[] = [];
  const repo: IAdminUserNoteRepository = {
    create(input: CreateAdminUserNoteInput): Promise<AdminUserNoteRecord> {
      createCalls.push(input);
      return Promise.resolve(makeRecord({ ...input, id: 'note-new' }));
    },
    listForUser(userId: string): Promise<AdminUserNoteRecord[]> {
      listCalls.push(userId);
      return Promise.resolve(list);
    },
  };
  return { repo, createCalls, listCalls };
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

describe('AdminUserNoteService', () => {
  describe('create', () => {
    it('persists the note against the path user + author admin and returns the wire shape', async () => {
      const { repo, createCalls } = makeRepo();
      const { audit } = makeAudit();

      const result = await new AdminUserNoteService(repo, audit).create(
        'user-42',
        'Escalated for manual review.',
        'admin-9',
      );

      expect(createCalls).toEqual([
        {
          userId: 'user-42',
          authorAdminId: 'admin-9',
          body: 'Escalated for manual review.',
        },
      ]);
      // Wire shape: id/body/authorAdminId/createdAt ISO — never leaks userId.
      expect(result).toEqual({
        id: 'note-new',
        body: 'Escalated for manual review.',
        authorAdminId: 'admin-9',
        createdAt: '2026-07-03T10:00:00.000Z',
      });
      expect(result).not.toHaveProperty('userId');
    });

    it('immutably audits an admin_update against the User subject with the author as actor', async () => {
      const { repo } = makeRepo();
      const { audit, calls } = makeAudit();

      await new AdminUserNoteService(repo, audit).create(
        'user-42',
        'Note body.',
        'admin-9',
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
      expect(calls[0].subject).toBe('User:user-42');
      expect(calls[0].actorAdminId).toBe('admin-9');
      expect(calls[0].after).toMatchObject({ noteId: 'note-new' });
      expect(calls[0].correlationId).toEqual(expect.any(String));
    });
  });

  describe('list', () => {
    it('returns the persisted notes projected to the wire shape', async () => {
      const records = [
        makeRecord({
          id: 'note-a',
          createdAt: new Date('2026-07-03T12:00:00.000Z'),
        }),
        makeRecord({
          id: 'note-b',
          createdAt: new Date('2026-07-03T09:00:00.000Z'),
        }),
      ];
      const { repo, listCalls } = makeRepo(records);
      const { audit } = makeAudit();

      const result = await new AdminUserNoteService(repo, audit).list('user-7');

      expect(listCalls).toEqual(['user-7']);
      expect(result).toEqual({
        items: [
          {
            id: 'note-a',
            body: 'Called the user to confirm identity.',
            authorAdminId: 'admin-1',
            createdAt: '2026-07-03T12:00:00.000Z',
          },
          {
            id: 'note-b',
            body: 'Called the user to confirm identity.',
            authorAdminId: 'admin-1',
            createdAt: '2026-07-03T09:00:00.000Z',
          },
        ],
      });
    });

    it('returns an empty item list when the user has no notes', async () => {
      const { repo } = makeRepo([]);
      const { audit } = makeAudit();

      const result = await new AdminUserNoteService(repo, audit).list('user-7');

      expect(result).toEqual({ items: [] });
    });

    it('does not audit a read', async () => {
      const { repo } = makeRepo([]);
      const { audit, calls } = makeAudit();

      await new AdminUserNoteService(repo, audit).list('user-7');

      expect(calls).toHaveLength(0);
    });
  });
});
