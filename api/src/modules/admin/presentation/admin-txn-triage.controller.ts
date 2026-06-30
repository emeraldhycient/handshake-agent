import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  AdminTxnActionResponseSchema,
  type AdminTxnActionResponse,
} from '@handshake-agent/contracts';

import { AdminTxnTriageService } from '../application/admin-txn-triage.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { AdminTxnMarkFailedDto } from './dto/admin-txn.dto';

/**
 * Phase 3 (sub-area B) — engine-brokered, audited, idempotent transaction TRIAGE.
 * Every route is permissioned (default-deny via PermissionGuard) AND requires a
 * fresh step-up (these are money-path actions). The service never moves money
 * directly (§3.1) and holds no DB credentials (§3.2). Responses are parsed through
 * their contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard, AdminStepUpGuard)
export class AdminTxnTriageController {
  constructor(private readonly triage: AdminTxnTriageService) {}

  @Post('transactions/:id/mark-failed')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(
    'api_route',
    'POST /admin/transactions/:id/mark-failed',
    'execute',
  )
  async markFailed(
    @Param('id') id: string,
    @Body() dto: AdminTxnMarkFailedDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminTxnActionResponse> {
    const result = await this.triage.markFailedAndRefund(
      id,
      dto.reason,
      admin.adminId,
    );
    return AdminTxnActionResponseSchema.parse(result);
  }

  @Post('transactions/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(
    'api_route',
    'POST /admin/transactions/:id/retry',
    'execute',
  )
  async retry(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminTxnActionResponse> {
    const result = await this.triage.retrySettlement(id, admin.adminId);
    return AdminTxnActionResponseSchema.parse(result);
  }
}
