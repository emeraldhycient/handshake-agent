import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  TreasuryAlertSchema,
  TreasuryAlertListResponseSchema,
  TreasuryBalancesResponseSchema,
  TreasuryExposureListResponseSchema,
  WithdrawalPolicyListResponseSchema,
  type TreasuryAlert,
  type TreasuryAlertListResponse,
  type TreasuryBalancesResponse,
  type TreasuryExposureListResponse,
  type WithdrawalPolicyListResponse,
} from '@handshake-agent/contracts';

import { AdminTreasuryService } from '../application/admin-treasury.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  TreasuryAlertAcknowledgeDto,
  TreasuryAlertQueryDto,
} from './dto/admin-treasury.dto';

/**
 * Phase 3 (sub-area D) — the admin TREASURY OVERSIGHT surface. All reads are
 * permissioned (default-deny via PermissionGuard); the one write — acknowledging
 * an alert — additionally requires a fresh step-up. The service never moves money
 * (§3.1) and holds no DB credentials (§3.2); responses are parsed through their
 * contract schema before leaving the boundary.
 */
@Controller('admin/treasury')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminTreasuryController {
  constructor(private readonly treasury: AdminTreasuryService) {}

  // ── balances ─────────────────────────────────────────────────────────────────

  @Get('balances')
  @RequirePermission('api_route', 'GET /admin/treasury/balances', 'read')
  async getBalances(): Promise<TreasuryBalancesResponse> {
    return TreasuryBalancesResponseSchema.parse(
      await this.treasury.getBalances(),
    );
  }

  // ── exposure ─────────────────────────────────────────────────────────────────

  @Get('exposure')
  @RequirePermission('api_route', 'GET /admin/treasury/exposure', 'read')
  async listExposure(): Promise<TreasuryExposureListResponse> {
    return TreasuryExposureListResponseSchema.parse(
      await this.treasury.listExposures(),
    );
  }

  // ── alerts ───────────────────────────────────────────────────────────────────

  @Get('alerts')
  @RequirePermission('api_route', 'GET /admin/treasury/alerts', 'read')
  async listAlerts(
    @Query() query: TreasuryAlertQueryDto,
  ): Promise<TreasuryAlertListResponse> {
    return TreasuryAlertListResponseSchema.parse(
      await this.treasury.listAlerts({ acknowledged: query.acknowledged }),
    );
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/treasury/alerts/:id/acknowledge',
    'write',
  )
  async acknowledgeAlert(
    @Param('id') id: string,
    @Body() dto: TreasuryAlertAcknowledgeDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<TreasuryAlert> {
    return TreasuryAlertSchema.parse(
      await this.treasury.acknowledgeAlert(id, admin.adminId, dto.note),
    );
  }

  // ── withdrawal policies ────────────────────────────────────────────────────────

  @Get('withdrawal-policies')
  @RequirePermission(
    'api_route',
    'GET /admin/treasury/withdrawal-policies',
    'read',
  )
  async listWithdrawalPolicies(): Promise<WithdrawalPolicyListResponse> {
    return WithdrawalPolicyListResponseSchema.parse(
      await this.treasury.listWithdrawalPolicies(),
    );
  }
}
