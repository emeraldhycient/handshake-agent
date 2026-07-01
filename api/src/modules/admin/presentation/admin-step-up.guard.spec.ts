import { ExecutionContext } from '@nestjs/common';

import { AdminStepUpRequiredError } from '../domain/admin-errors';
import { AdminStepUpGuard } from './admin-step-up.guard';
import type { AdminContext } from './current-admin.decorator';
import type { AdminStepUpService } from '../application/admin-step-up.service';

const admin: AdminContext = {
  adminId: 'admin-1',
  sessionId: 'sess-1',
  roleId: 'role-1',
  email: 'admin@x.io',
};

function ctx(): ExecutionContext {
  const req = { admin };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function build(fresh: boolean) {
  const stepUp = {
    assertFresh: jest.fn(() =>
      fresh
        ? Promise.resolve()
        : Promise.reject(new AdminStepUpRequiredError()),
    ),
  } as unknown as jest.Mocked<AdminStepUpService>;
  return { guard: new AdminStepUpGuard(stepUp), stepUp };
}

describe('AdminStepUpGuard', () => {
  it('returns true when the session has a fresh step-up', async () => {
    const { guard, stepUp } = build(true);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(stepUp.assertFresh).toHaveBeenCalledWith('sess-1', expect.any(Date));
  });

  it('propagates AdminStepUpRequiredError when the step-up is stale', async () => {
    const { guard } = build(false);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(
      AdminStepUpRequiredError,
    );
  });
});
