import { Test, type TestingModule } from '@nestjs/testing';

import type {
  BlockedEntry,
  BlockedEntryListResponse,
} from '@handshake-agent/contracts';

import { AdminBlockedController } from './admin-blocked.controller';
import { AdminBlockedListService } from '../application/admin-blocked-list.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import type { AdminContext } from './current-admin.decorator';
import type {
  BlockedEntryCreateDto,
  BlockedEntrySupersedeDto,
} from './dto/admin-blocked.dto';

const ADMIN: AdminContext = {
  adminId: 'admin-uuid-1',
  sessionId: 'sess-1',
  roleId: 'role-1',
  email: 'ops@handshake.test',
};

const ENTRY: BlockedEntry = {
  id: 'blk-1',
  kind: 'address',
  value: 'TXYZ',
  reason: 'flagged',
  addedByAdminId: ADMIN.adminId,
  createdAt: '2026-07-03T10:00:00.000Z',
  supersededAt: null,
};

function makeService(): jest.Mocked<
  Pick<AdminBlockedListService, 'list' | 'add' | 'supersede'>
> {
  return {
    list: jest.fn(),
    add: jest.fn(),
    supersede: jest.fn(),
  };
}

async function buildController(
  service: ReturnType<typeof makeService>,
): Promise<AdminBlockedController> {
  const allow = { canActivate: () => true };
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AdminBlockedController],
    providers: [{ provide: AdminBlockedListService, useValue: service }],
  })
    .overrideGuard(AdminSessionGuard)
    .useValue(allow)
    .overrideGuard(PermissionGuard)
    .useValue(allow)
    .overrideGuard(AdminStepUpGuard)
    .useValue(allow)
    .compile();

  return module.get(AdminBlockedController);
}

describe('AdminBlockedController', () => {
  let service: ReturnType<typeof makeService>;
  let controller: AdminBlockedController;

  beforeEach(async () => {
    service = makeService();
    controller = await buildController(service);
  });

  it('GET /admin/blocked returns the parsed active list', async () => {
    const response: BlockedEntryListResponse = { items: [ENTRY] };
    service.list.mockResolvedValue(response);

    const result = await controller.list();

    expect(service.list).toHaveBeenCalledTimes(1);
    expect(result).toEqual(response);
  });

  it('POST /admin/blocked delegates with the authenticated actor and returns the entry', async () => {
    service.add.mockResolvedValue(ENTRY);
    const dto = {
      kind: 'address',
      value: 'TXYZ',
      reason: 'flagged',
    } as BlockedEntryCreateDto;

    const result = await controller.add(dto, ADMIN);

    // Actor is threaded from the principal, never a body param.
    expect(service.add).toHaveBeenCalledWith(
      { kind: 'address', value: 'TXYZ', reason: 'flagged' },
      ADMIN.adminId,
    );
    expect(result).toEqual(ENTRY);
  });

  it('POST /admin/blocked/:id/supersede delegates id + reason + actor', async () => {
    const lifted: BlockedEntry = {
      ...ENTRY,
      supersededAt: '2026-07-03T12:00:00.000Z',
    };
    service.supersede.mockResolvedValue(lifted);
    const dto: BlockedEntrySupersedeDto = { reason: 'cleared' };

    const result = await controller.supersede('blk-1', dto, ADMIN);

    expect(service.supersede).toHaveBeenCalledWith(
      'blk-1',
      'cleared',
      ADMIN.adminId,
    );
    expect(result.supersededAt).toBe('2026-07-03T12:00:00.000Z');
  });
});
