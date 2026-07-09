import { PatNotFoundError } from '../domain/pat-errors';
import { PinInvalidError } from '../../../core/auth/domain/pin-errors';
import type { PinService } from '../../../core/auth/pin.service';
import type { IPatRepository, PatRecord } from './ports/pat.repository.port';
import { PatService } from './pat.service';

const NOW = new Date('2026-07-08T10:00:00.000Z');

type CreateInput = Parameters<IPatRepository['create']>[0];
type CreateMock = jest.MockedFunction<IPatRepository['create']>;

function echoRecord(input: CreateInput): PatRecord {
  return {
    id: '018f6b3a-0000-7000-8000-000000000001',
    label: input.label,
    scopes: input.scopes,
    createdAt: NOW,
    lastUsedAt: null,
    expiresAt: input.expiresAt,
  };
}

function makeRepo(overrides: Partial<IPatRepository> = {}): IPatRepository {
  return {
    create: jest.fn((input: CreateInput) => Promise.resolve(echoRecord(input))),
    listForUser: jest.fn().mockResolvedValue([]),
    findActiveByTokenHash: jest.fn().mockResolvedValue(null),
    revoke: jest.fn().mockResolvedValue(true),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Typed access to the nth `create` call's input (no unsafe `any` reads). */
function createInputOf(repo: IPatRepository, call = 0): CreateInput {
  return (repo.create as CreateMock).mock.calls[call][0];
}

function makePin(verifyPin: jest.Mock = jest.fn()): PinService {
  return { verifyPin } as unknown as PinService;
}

describe('PatService.mint', () => {
  it('verifies the PIN BEFORE creating anything (sensitive action, §3.3)', async () => {
    const order: string[] = [];
    const verifyPin = jest.fn(() => {
      order.push('verifyPin');
      return Promise.resolve();
    });
    const repo = makeRepo({
      create: jest.fn((input: CreateInput) => {
        order.push('create');
        return Promise.resolve(echoRecord(input));
      }),
    });
    const svc = new PatService(repo, makePin(verifyPin));

    await svc.mint({
      userId: 'u1',
      label: 'Claude',
      pin: '8047',
      scopes: ['read'],
    });

    expect(verifyPin).toHaveBeenCalledWith('u1', '8047');
    expect(order).toEqual(['verifyPin', 'create']);
  });

  it('propagates PIN errors and never touches the repository', async () => {
    const repo = makeRepo();
    const svc = new PatService(
      repo,
      makePin(jest.fn().mockRejectedValue(new PinInvalidError(3))),
    );

    await expect(
      svc.mint({ userId: 'u1', label: 'x', pin: '0000', scopes: ['read'] }),
    ).rejects.toBeInstanceOf(PinInvalidError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('returns the raw hsk_pat_ token once and stores ONLY its sha256 hash', async () => {
    const repo = makeRepo();
    const svc = new PatService(repo, makePin());

    const out = await svc.mint({
      userId: 'u1',
      label: 'Claude',
      pin: '8047',
      scopes: ['read', 'chat:propose'],
    });

    expect(out.token).toMatch(/^hsk_pat_[0-9a-f]{64}$/);
    const createInput = createInputOf(repo);
    expect(createInput.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createInput.tokenHash).not.toContain(out.token);
    expect(createInput).not.toHaveProperty('token');
    // sha256('raw token') must be reproducible from the returned raw token.
    const { createHash } =
      jest.requireActual<typeof import('node:crypto')>('node:crypto');
    expect(createInput.tokenHash).toBe(
      createHash('sha256').update(out.token, 'utf8').digest('hex'),
    );
  });

  it('mints unique tokens across calls and dedupes scopes', async () => {
    const repo = makeRepo();
    const svc = new PatService(repo, makePin());

    const a = await svc.mint({
      userId: 'u1',
      label: 'a',
      pin: '8047',
      scopes: ['read', 'read', 'chat:propose'],
    });
    const b = await svc.mint({
      userId: 'u1',
      label: 'b',
      pin: '8047',
      scopes: ['read'],
    });

    expect(a.token).not.toBe(b.token);
    expect(createInputOf(repo).scopes).toEqual(['read', 'chat:propose']);
  });

  it('computes expiresAt from expiresInDays (null when omitted)', async () => {
    const repo = makeRepo();
    const svc = new PatService(repo, makePin());

    await svc.mint({
      userId: 'u1',
      label: 'expiring',
      pin: '8047',
      scopes: ['read'],
      expiresInDays: 90,
    });
    await svc.mint({
      userId: 'u1',
      label: 'forever',
      pin: '8047',
      scopes: ['read'],
    });

    const first = createInputOf(repo, 0);
    const second = createInputOf(repo, 1);
    expect(first.expiresAt).toBeInstanceOf(Date);
    const expiresAt = first.expiresAt as Date;
    const deltaDays =
      (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(deltaDays).toBeGreaterThan(89.9);
    expect(deltaDays).toBeLessThanOrEqual(90);
    expect(second.expiresAt).toBeNull();
  });

  it('returns the contract response shape (ISO strings, no hash)', async () => {
    const svc = new PatService(makeRepo(), makePin());
    const out = await svc.mint({
      userId: 'u1',
      label: 'Claude',
      pin: '8047',
      scopes: ['read'],
    });

    expect(out).toMatchObject({
      id: '018f6b3a-0000-7000-8000-000000000001',
      label: 'Claude',
      scopes: ['read'],
      createdAt: NOW.toISOString(),
      expiresAt: null,
    });
    expect(out).not.toHaveProperty('tokenHash');
  });
});

describe('PatService.list', () => {
  it('returns the masked projection (id/label/scopes/timestamps only)', async () => {
    const repo = makeRepo({
      listForUser: jest.fn().mockResolvedValue([
        {
          id: '018f6b3a-0000-7000-8000-000000000001',
          label: 'Claude',
          scopes: ['read'],
          createdAt: NOW,
          lastUsedAt: new Date('2026-07-08T11:00:00.000Z'),
          expiresAt: null,
        },
      ]),
    });
    const svc = new PatService(repo, makePin());

    const out = await svc.list('u1');
    expect(repo.listForUser).toHaveBeenCalledWith('u1');
    expect(out).toEqual({
      tokens: [
        {
          id: '018f6b3a-0000-7000-8000-000000000001',
          label: 'Claude',
          scopes: ['read'],
          createdAt: NOW.toISOString(),
          lastUsedAt: '2026-07-08T11:00:00.000Z',
          expiresAt: null,
        },
      ],
    });
  });
});

describe('PatService.revoke', () => {
  it('revokes an owned token', async () => {
    const repo = makeRepo({ revoke: jest.fn().mockResolvedValue(true) });
    const svc = new PatService(repo, makePin());

    await expect(svc.revoke('u1', 'pat-1')).resolves.toBeUndefined();
    expect(repo.revoke).toHaveBeenCalledWith('u1', 'pat-1', expect.any(Date));
  });

  it('throws PatNotFoundError for a foreign/unknown/already-revoked id (fail closed)', async () => {
    const repo = makeRepo({ revoke: jest.fn().mockResolvedValue(false) });
    const svc = new PatService(repo, makePin());

    await expect(svc.revoke('u1', 'someone-elses')).rejects.toBeInstanceOf(
      PatNotFoundError,
    );
  });
});
