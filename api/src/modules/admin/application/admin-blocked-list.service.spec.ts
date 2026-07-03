import { AdminBlockedListService } from './admin-blocked-list.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type {
  BlockedEntryRecord,
  IBlockedListRepository,
} from './ports/blocked-list.repository.port';
import type { AuditService } from '../../../core/audit/application/audit.service';

const ADMIN_ID = 'admin-uuid-1';

function makeRepo(): jest.Mocked<IBlockedListRepository> {
  return {
    listActive: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    supersede: jest.fn(),
  };
}

function makeAudit(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

function makeEntry(
  overrides: Partial<BlockedEntryRecord> = {},
): BlockedEntryRecord {
  return {
    id: 'blk-1',
    kind: 'address',
    value: 'TXYZ...deadbeef',
    reason: 'Chain-analysis flagged sanctioned mixer.',
    addedByAdminId: ADMIN_ID,
    createdAt: new Date('2026-07-03T10:00:00.000Z'),
    supersededAt: null,
    ...overrides,
  };
}

describe('AdminBlockedListService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let audit: ReturnType<typeof makeAudit>;
  let service: AdminBlockedListService;

  beforeEach(() => {
    repo = makeRepo();
    audit = makeAudit();
    service = new AdminBlockedListService(repo, audit);
  });

  describe('list', () => {
    it('projects the active entries to the wire shape (ISO dates), newest-first', async () => {
      repo.listActive.mockResolvedValue([
        makeEntry({ id: 'blk-2', kind: 'user', value: 'user-9' }),
        makeEntry({
          id: 'blk-1',
          supersededAt: null,
        }),
      ]);

      const result = await service.list();

      expect(repo.listActive).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: 'blk-2',
        kind: 'user',
        value: 'user-9',
        reason: 'Chain-analysis flagged sanctioned mixer.',
        addedByAdminId: ADMIN_ID,
        createdAt: '2026-07-03T10:00:00.000Z',
        supersededAt: null,
      });
      // Read moves no money and writes no audit line.
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('returns an empty list when nothing is blocked', async () => {
      repo.listActive.mockResolvedValue([]);
      const result = await service.list();
      expect(result.items).toEqual([]);
    });
  });

  describe('add', () => {
    it('appends the block with the actor as addedByAdminId and returns the wire shape', async () => {
      const created = makeEntry({ id: 'blk-new' });
      repo.create.mockResolvedValue(created);

      const result = await service.add(
        {
          kind: 'address',
          value: 'TXYZ...deadbeef',
          reason: 'Chain-analysis flagged sanctioned mixer.',
        },
        ADMIN_ID,
      );

      // The actor is threaded from the authenticated principal, never the body.
      expect(repo.create).toHaveBeenCalledWith({
        kind: 'address',
        value: 'TXYZ...deadbeef',
        reason: 'Chain-analysis flagged sanctioned mixer.',
        addedByAdminId: ADMIN_ID,
      });
      expect(result).toEqual({
        id: 'blk-new',
        kind: 'address',
        value: 'TXYZ...deadbeef',
        reason: 'Chain-analysis flagged sanctioned mixer.',
        addedByAdminId: ADMIN_ID,
        createdAt: '2026-07-03T10:00:00.000Z',
        supersededAt: null,
      });
    });

    it('immutably audits the add as an admin_override with the reason (no before)', async () => {
      repo.create.mockResolvedValue(makeEntry({ id: 'blk-new' }));

      await service.add(
        {
          kind: 'bank',
          value: '0123456789',
          reason: 'Mule account reported by partner bank.',
        },
        ADMIN_ID,
      );

      expect(audit.record).toHaveBeenCalledTimes(1);
      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_override');
      expect(arg.subject).toBe('BlockedEntry:blk-new');
      expect(arg.actorAdminId).toBe(ADMIN_ID);
      expect(arg.before ?? null).toBeNull();
      expect(arg.after).toMatchObject({
        disposition: 'blocked',
        kind: 'bank',
        value: '0123456789',
        reason: 'Mule account reported by partner bank.',
      });
    });
  });

  describe('supersede', () => {
    it('lifts an active block and returns the superseded wire shape', async () => {
      repo.supersede.mockResolvedValue(
        makeEntry({
          id: 'blk-1',
          supersededAt: new Date('2026-07-03T12:00:00.000Z'),
        }),
      );

      const result = await service.supersede(
        'blk-1',
        'False positive — cleared by compliance.',
        ADMIN_ID,
      );

      // The actor is threaded from the principal → recorded as supersededByAdminId.
      expect(repo.supersede).toHaveBeenCalledWith('blk-1', ADMIN_ID);
      expect(result.supersededAt).toBe('2026-07-03T12:00:00.000Z');
      expect(result.id).toBe('blk-1');
    });

    it('immutably audits the lift as an admin_override with the reason', async () => {
      repo.supersede.mockResolvedValue(
        makeEntry({
          id: 'blk-1',
          supersededAt: new Date('2026-07-03T12:00:00.000Z'),
        }),
      );

      await service.supersede('blk-1', 'cleared', ADMIN_ID);

      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_override');
      expect(arg.subject).toBe('BlockedEntry:blk-1');
      expect(arg.actorAdminId).toBe(ADMIN_ID);
      expect(arg.after).toMatchObject({
        disposition: 'lifted',
        reason: 'cleared',
      });
    });

    it('fails closed (404, no audit) when the entry is unknown or already lifted', async () => {
      repo.supersede.mockResolvedValue(null);

      await expect(
        service.supersede('nope', 'why', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
