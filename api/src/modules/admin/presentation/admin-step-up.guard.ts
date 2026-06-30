import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { AdminStepUpService } from '../application/admin-step-up.service';
import type { AdminContext } from './current-admin.decorator';

/**
 * Gates a sensitive admin route on a fresh step-up (re-auth) for the current
 * session. Fail-closed: a missing or stale step-up surfaces as
 * AdminStepUpRequiredError (mapped to its HTTP status by the global filter).
 * Runs after AdminSessionGuard, which populates `req.admin`.
 */
@Injectable()
export class AdminStepUpGuard implements CanActivate {
  constructor(private readonly stepUp: AdminStepUpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ admin: AdminContext }>();
    await this.stepUp.assertFresh(req.admin.sessionId, new Date());
    return true;
  }
}
