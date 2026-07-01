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
  TreasuryFiatFloatResponseSchema,
  TreasuryFxPositionResponseSchema,
  TreasuryPayoutQueueResponseSchema,
  TreasurySweepListResponseSchema,
  WithdrawalPolicyListResponseSchema,
  type TreasuryAlert,
  type TreasuryAlertListResponse,
  type TreasuryBalancesResponse,
  type TreasuryExposureListResponse,
  type TreasuryFiatFloatResponse,
  type TreasuryFxPositionResponse,
  type TreasuryPayoutQueueResponse,
  type TreasurySweepListResponse,
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

  // ── child-address sweeps (Phase 6b, READ) ──────────────────────────────────────

  @Get('sweeps')
  @RequirePermission('api_route', 'GET /admin/treasury/sweeps', 'read')
  async listSweeps(): Promise<TreasurySweepListResponse> {
    return TreasurySweepListResponseSchema.parse(
      await this.treasury.listSweeps(),
    );
  }

  // ── payout / withdrawal approval queue (Phase 6b, READ-ONLY) ─────────────────────

  @Get('payout-queue')
  @RequirePermission('api_route', 'GET /admin/treasury/payout-queue', 'read')
  async listPayoutQueue(): Promise<TreasuryPayoutQueueResponse> {
    return TreasuryPayoutQueueResponseSchema.parse(
      await this.treasury.listPayoutQueue(),
    );
  }

  // ── NGN fiat float vs configured target (Phase 6b, READ) ─────────────────────────

  @Get('fiat-float')
  @RequirePermission('api_route', 'GET /admin/treasury/fiat-float', 'read')
  async listFiatFloat(): Promise<TreasuryFiatFloatResponse> {
    return TreasuryFiatFloatResponseSchema.parse(
      await this.treasury.listFiatFloat(),
    );
  }

  // ── FX position / exposure headroom (Phase 6b, READ) ─────────────────────────────

  @Get('fx-position')
  @RequirePermission('api_route', 'GET /admin/treasury/fx-position', 'read')
  async listFxPositions(): Promise<TreasuryFxPositionResponse> {
    return TreasuryFxPositionResponseSchema.parse(
      await this.treasury.listFxPositions(),
    );
  }
}
