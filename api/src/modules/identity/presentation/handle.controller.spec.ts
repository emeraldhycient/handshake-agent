import {
  HandleTakenError,
  NicknameCapError,
  PayIdAlreadyChangedError,
} from '../domain/handle-errors';
import type { HandleService } from '../application/handle.service';
import type { AuthenticatedUser } from '../../auth/presentation/jwt-auth.guard';
import { HandleController } from './handle.controller';

const CURRENT_USER: AuthenticatedUser = {
  userId: 'u1',
  sessionId: 's1',
  deviceId: 'd1',
};

function makeController(overrides: Partial<HandleService> = {}) {
  const handles = {
    listPublicNicknames: jest.fn().mockResolvedValue([]),
    addPublicNickname: jest.fn().mockResolvedValue({
      id: 'ed69036f-01bd-45fb-a3ec-671df977a1e0',
      alias: 'ada2',
    }),
    removePublicNickname: jest.fn().mockResolvedValue(undefined),
    changePayId: jest.fn().mockResolvedValue(undefined),
    resolveHandle: jest.fn(),
    ...overrides,
  };
  return {
    controller: new HandleController(handles as unknown as HandleService),
    handles,
  };
}

describe('HandleController.list (GET /profile/public-nicknames)', () => {
  it("returns the caller's own nicknames, schema-parsed", async () => {
    const { controller, handles } = makeController({
      listPublicNicknames: jest
        .fn()
        .mockResolvedValue([
          { id: 'ed69036f-01bd-45fb-a3ec-671df977a1e0', alias: 'ada2' },
        ]),
    });

    const out = await controller.list(CURRENT_USER);

    expect(handles.listPublicNicknames).toHaveBeenCalledWith('u1');
    expect(out).toEqual({
      nicknames: [
        { id: 'ed69036f-01bd-45fb-a3ec-671df977a1e0', alias: 'ada2' },
      ],
    });
  });
});

describe('HandleController.create (POST /profile/public-nicknames)', () => {
  it('delegates to the service for the CURRENT user and returns the created nickname', async () => {
    const { controller, handles } = makeController();

    const out = await controller.create({ alias: 'ada2' }, CURRENT_USER);

    expect(handles.addPublicNickname).toHaveBeenCalledWith('u1', 'ada2');
    expect(out).toEqual({
      id: 'ed69036f-01bd-45fb-a3ec-671df977a1e0',
      alias: 'ada2',
    });
  });

  it('lets HandleTakenError bubble to the global filter unchanged (409, no local catch)', async () => {
    const { controller } = makeController({
      addPublicNickname: jest
        .fn()
        .mockRejectedValue(new HandleTakenError('ada2')),
    });

    await expect(
      controller.create({ alias: 'ada2' }, CURRENT_USER),
    ).rejects.toBeInstanceOf(HandleTakenError);
  });

  it('lets NicknameCapError bubble to the global filter unchanged (422, no local catch)', async () => {
    const { controller } = makeController({
      addPublicNickname: jest.fn().mockRejectedValue(new NicknameCapError(5)),
    });

    await expect(
      controller.create({ alias: 'sixth' }, CURRENT_USER),
    ).rejects.toBeInstanceOf(NicknameCapError);
  });
});

describe('HandleController.remove (DELETE /profile/public-nicknames/:id)', () => {
  it('delegates to the service for the CURRENT user and resolves void (204)', async () => {
    const { controller, handles } = makeController();

    await expect(
      controller.remove('ed69036f-01bd-45fb-a3ec-671df977a1e0', CURRENT_USER),
    ).resolves.toBeUndefined();
    expect(handles.removePublicNickname).toHaveBeenCalledWith(
      'u1',
      'ed69036f-01bd-45fb-a3ec-671df977a1e0',
    );
  });
});

describe('HandleController.changePayId (PATCH /profile/payid)', () => {
  it('delegates to the service for the CURRENT user and resolves void (204 body-less)', async () => {
    const { controller, handles } = makeController();

    await expect(
      controller.changePayId({ payId: 'newhandle' }, CURRENT_USER),
    ).resolves.toBeUndefined();
    expect(handles.changePayId).toHaveBeenCalledWith('u1', 'newhandle');
  });

  it('lets PayIdAlreadyChangedError bubble to the global filter unchanged (409, no local catch)', async () => {
    const { controller } = makeController({
      changePayId: jest.fn().mockRejectedValue(new PayIdAlreadyChangedError()),
    });

    await expect(
      controller.changePayId({ payId: 'newhandle' }, CURRENT_USER),
    ).rejects.toBeInstanceOf(PayIdAlreadyChangedError);
  });

  it('lets HandleTakenError bubble to the global filter unchanged (409, no local catch)', async () => {
    const { controller } = makeController({
      changePayId: jest.fn().mockRejectedValue(new HandleTakenError('taken')),
    });

    await expect(
      controller.changePayId({ payId: 'taken' }, CURRENT_USER),
    ).rejects.toBeInstanceOf(HandleTakenError);
  });
});
