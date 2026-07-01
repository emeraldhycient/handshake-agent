import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  AdminBeneficiaryListResponseSchema,
  type AdminBeneficiaryListResponse,
} from '@handshake-agent/contracts';

import { AdminBeneficiaryService } from '../application/admin-beneficiary.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';

/**
 * Phase 3 (sub-area D) — the admin BENEFICIARY OVERSIGHT surface. The list is
 * permissioned read-only (default-deny via PermissionGuard); the cooling-off
 * override is a step-up-gated write that clears a first-use lock (IDN-08) and is
 * audited. The service never moves money (§3.1) and holds no DB credentials
 * (§3.2); the list response is parsed through its contract schema.
 */
@Controller('admin/beneficiaries')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminBeneficiariesController {
  constructor(private readonly beneficiaries: AdminBeneficiaryService) {}

  @Get()
  @RequirePermission('api_route', 'GET /admin/beneficiaries', 'read')
  async list(): Promise<AdminBeneficiaryListResponse> {
    return AdminBeneficiaryListResponseSchema.parse(
      await this.beneficiaries.list(),
    );
  }

  @Post(':id/cooling-off-override')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/beneficiaries/:id/cooling-off-override',
    'write',
  )
  async overrideCoolingOff(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.beneficiaries.overrideCoolingOff(id, admin.adminId);
  }
}
