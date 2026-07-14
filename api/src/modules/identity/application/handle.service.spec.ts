import {
  HandleTakenError,
  NicknameCapError,
  PayIdAlreadyChangedError,
} from '../domain/handle-errors';
import type {
  HandleOwnerRecord,
  IHandleRepository,
} from './ports/handle.repository.port';
import { HandleService } from './handle.service';

function makeService(overrides: Partial<jest.Mocked<IHandleRepository>> = {}) {
  const repo: jest.Mocked<IHandleRepository> = {
    findUserByPayId: jest.fn().mockResolvedValue(null),
    findAliasOwner: jest.fn().mockResolvedValue(null),
    isPayIdTaken: jest.fn().mockResolvedValue(false),
    isAliasTaken: jest.fn().mockResolvedValue(false),
    countPublicNicknames: jest.fn().mockResolvedValue(0),
    createPublicNickname: jest
      .fn()
      .mockResolvedValue({ id: 'nick-1', alias: 'ada2' }),
    deletePublicNickname: jest.fn().mockResolvedValue(undefined),
    listPublicNicknames: jest.fn().mockResolvedValue([]),
    getPayIdChangedAt: jest.fn().mockResolvedValue(null),
    setPayId: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  const svc = new HandleService(repo);
  return { svc, repo };
}

const ADA_OWNER: HandleOwnerRecord = {
  userId: 'user-ada',
  handle: 'ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

describe('HandleService.resolveHandle', () => {
  it('resolves a payId hit case-insensitively and applies leading-@ normalization', async () => {
    const { svc, repo } = makeService({
      findUserByPayId: jest.fn().mockResolvedValue(ADA_OWNER),
    });

    const out = await svc.resolveHandle('@Ada');

    expect(repo.findUserByPayId).toHaveBeenCalledWith('ada');
    expect(out).toEqual({
      userId: 'user-ada',
      displayName: 'Ada L.',
      handle: 'ada',
    });
  });

  it('falls back to a public-nickname match when no payId matches', async () => {
    const nicknameOwner: HandleOwnerRecord = {
      userId: 'user-chidi',
      handle: 'chichi',
      firstName: 'Chidi',
      lastName: 'Okoro',
    };
    const { svc, repo } = makeService({
      findUserByPayId: jest.fn().mockResolvedValue(null),
      findAliasOwner: jest.fn().mockResolvedValue(nicknameOwner),
    });

    const out = await svc.resolveHandle('chichi');

    expect(repo.findAliasOwner).toHaveBeenCalledWith('chichi');
    expect(out).toEqual({
      userId: 'user-chidi',
      displayName: 'Chidi O.',
      handle: 'chichi',
    });
  });

  it('does NOT fall through to the alias lookup on a payId hit', async () => {
    const { svc, repo } = makeService({
      findUserByPayId: jest.fn().mockResolvedValue(ADA_OWNER),
    });

    await svc.resolveHandle('ada');

    expect(repo.findAliasOwner).not.toHaveBeenCalled();
  });

  it('returns null on a miss (never a default — §3.1 no-misroute)', async () => {
    const { svc } = makeService();

    await expect(svc.resolveHandle('@nobody')).resolves.toBeNull();
  });

  it('returns null for an empty/whitespace-only/bare-@ handle without querying the repo', async () => {
    const { svc, repo } = makeService();

    await expect(svc.resolveHandle('@')).resolves.toBeNull();
    await expect(svc.resolveHandle('   ')).resolves.toBeNull();
    expect(repo.findUserByPayId).not.toHaveBeenCalled();
  });

  it('minimal-reveal display name falls back to the handle when no KYC name is on file', async () => {
    const { svc } = makeService({
      findUserByPayId: jest.fn().mockResolvedValue({
        userId: 'user-noname',
        handle: 'noname',
        firstName: null,
        lastName: null,
      } satisfies HandleOwnerRecord),
    });

    const out = await svc.resolveHandle('noname');

    expect(out?.displayName).toBe('noname');
  });

  it('minimal-reveal display name omits the last initial when only a first name is on file', async () => {
    const { svc } = makeService({
      findUserByPayId: jest.fn().mockResolvedValue({
        userId: 'user-solo',
        handle: 'solo',
        firstName: 'Amara',
        lastName: null,
      } satisfies HandleOwnerRecord),
    });

    const out = await svc.resolveHandle('solo');

    expect(out?.displayName).toBe('Amara');
  });
});

describe('HandleService.addPublicNickname', () => {
  it('claims a nickname when the shared namespace is free and under the cap', async () => {
    const { svc, repo } = makeService();

    const out = await svc.addPublicNickname('user-1', 'Ada2');

    expect(repo.isPayIdTaken).toHaveBeenCalledWith('ada2');
    expect(repo.isAliasTaken).toHaveBeenCalledWith('ada2');
    expect(repo.createPublicNickname).toHaveBeenCalledWith('user-1', 'ada2');
    expect(out).toEqual({ id: 'nick-1', alias: 'ada2' });
  });

  it('rejects a handle already claimed as a PayID (shared namespace)', async () => {
    const { svc, repo } = makeService({
      isPayIdTaken: jest.fn().mockResolvedValue(true),
    });

    await expect(svc.addPublicNickname('user-1', 'ada')).rejects.toBeInstanceOf(
      HandleTakenError,
    );
    expect(repo.createPublicNickname).not.toHaveBeenCalled();
  });

  it('rejects a handle already claimed as another public nickname (shared namespace)', async () => {
    const { svc, repo } = makeService({
      isAliasTaken: jest.fn().mockResolvedValue(true),
    });

    await expect(
      svc.addPublicNickname('user-1', 'taken'),
    ).rejects.toBeInstanceOf(HandleTakenError);
    expect(repo.createPublicNickname).not.toHaveBeenCalled();
  });

  it('enforces the ≤5 cap BEFORE inserting', async () => {
    const { svc, repo } = makeService({
      countPublicNicknames: jest.fn().mockResolvedValue(5),
    });

    await expect(
      svc.addPublicNickname('user-1', 'sixth'),
    ).rejects.toBeInstanceOf(NicknameCapError);
    expect(repo.createPublicNickname).not.toHaveBeenCalled();
  });

  it('allows the 5th nickname (cap is ≤5, not <5)', async () => {
    const { svc, repo } = makeService({
      countPublicNicknames: jest.fn().mockResolvedValue(4),
    });

    await svc.addPublicNickname('user-1', 'fifth');

    expect(repo.createPublicNickname).toHaveBeenCalledWith('user-1', 'fifth');
  });

  it('propagates HandleTakenError from a repository-level race (DB unique-index close)', async () => {
    const { svc } = makeService({
      createPublicNickname: jest
        .fn()
        .mockRejectedValue(new HandleTakenError('raced')),
    });

    await expect(
      svc.addPublicNickname('user-1', 'raced'),
    ).rejects.toBeInstanceOf(HandleTakenError);
  });

  it('rejects a malformed alias before any repository call', async () => {
    const { svc, repo } = makeService();

    await expect(svc.addPublicNickname('user-1', 'ab')).rejects.toThrow();
    expect(repo.isPayIdTaken).not.toHaveBeenCalled();
  });

  it('rejects a reserved handle before any repository call', async () => {
    const { svc, repo } = makeService();

    await expect(svc.addPublicNickname('user-1', 'admin')).rejects.toThrow();
    expect(repo.isPayIdTaken).not.toHaveBeenCalled();
  });
});

describe('HandleService.removePublicNickname / listPublicNicknames', () => {
  it('delegates removal to the repository, scoped by owner', async () => {
    const { svc, repo } = makeService();

    await svc.removePublicNickname('user-1', 'nick-1');

    expect(repo.deletePublicNickname).toHaveBeenCalledWith('user-1', 'nick-1');
  });

  it('lists the owner-scoped nicknames', async () => {
    const rows = [{ id: 'n1', alias: 'a1' }];
    const { svc } = makeService({
      listPublicNicknames: jest.fn().mockResolvedValue(rows),
    });

    await expect(svc.listPublicNicknames('user-1')).resolves.toEqual(rows);
  });
});

describe('HandleService.changePayId', () => {
  it('changes the PayID when never changed and the handle is free', async () => {
    const { svc, repo } = makeService();

    await svc.changePayId('user-1', 'newhandle');

    expect(repo.setPayId).toHaveBeenCalledWith('user-1', 'newhandle');
  });

  it('rejects a second change even when the new handle IS available', async () => {
    const { svc, repo } = makeService({
      getPayIdChangedAt: jest.fn().mockResolvedValue(new Date('2026-07-01')),
    });

    await expect(
      svc.changePayId('user-1', 'freehandle'),
    ).rejects.toBeInstanceOf(PayIdAlreadyChangedError);
    expect(repo.isPayIdTaken).not.toHaveBeenCalled();
    expect(repo.setPayId).not.toHaveBeenCalled();
  });

  it('rejects a concurrent second change that passed the stale read but LOST the conditional write (count===0)', async () => {
    // Simulates the TOCTOU race: getPayIdChangedAt still reads null (the
    // competing change had not committed yet), the handle is free, but the
    // conditional `updateMany({ where: { payIdChangedAt: null } })` matches
    // zero rows because the other change won — setPayId returns false. The
    // service must translate that into PayIdAlreadyChangedError, NOT succeed.
    const { svc, repo } = makeService({
      getPayIdChangedAt: jest.fn().mockResolvedValue(null),
      setPayId: jest.fn().mockResolvedValue(false),
    });

    await expect(
      svc.changePayId('user-1', 'racedhandle'),
    ).rejects.toBeInstanceOf(PayIdAlreadyChangedError);
    // It DID attempt the conditional write (the guard is the write, not the read).
    expect(repo.setPayId).toHaveBeenCalledWith('user-1', 'racedhandle');
  });

  it('rejects a handle already taken (shared namespace) on a first change', async () => {
    const { svc, repo } = makeService({
      isAliasTaken: jest.fn().mockResolvedValue(true),
    });

    await expect(
      svc.changePayId('user-1', 'takenalias'),
    ).rejects.toBeInstanceOf(HandleTakenError);
    expect(repo.setPayId).not.toHaveBeenCalled();
  });

  it('checks the one-change guard BEFORE the shared-namespace check', async () => {
    const { svc, repo } = makeService({
      getPayIdChangedAt: jest.fn().mockResolvedValue(new Date('2026-07-01')),
      isPayIdTaken: jest.fn().mockResolvedValue(true),
    });

    await expect(svc.changePayId('user-1', 'whatever')).rejects.toBeInstanceOf(
      PayIdAlreadyChangedError,
    );
    expect(repo.isPayIdTaken).not.toHaveBeenCalled();
  });

  it('propagates HandleTakenError from a repository-level race (DB unique-index close)', async () => {
    const { svc } = makeService({
      setPayId: jest.fn().mockRejectedValue(new HandleTakenError('raced')),
    });

    await expect(svc.changePayId('user-1', 'raced')).rejects.toBeInstanceOf(
      HandleTakenError,
    );
  });

  it('normalizes (strips @, lowercases) before validating and checking', async () => {
    const { svc, repo } = makeService();

    await svc.changePayId('user-1', '@NewHandle');

    expect(repo.isPayIdTaken).toHaveBeenCalledWith('newhandle');
    expect(repo.setPayId).toHaveBeenCalledWith('user-1', 'newhandle');
  });

  it('rejects a malformed/reserved payId before any repository call', async () => {
    const { svc, repo } = makeService();

    await expect(svc.changePayId('user-1', 'ab')).rejects.toThrow();
    await expect(svc.changePayId('user-1', 'support')).rejects.toThrow();
    expect(repo.getPayIdChangedAt).not.toHaveBeenCalled();
  });
});
