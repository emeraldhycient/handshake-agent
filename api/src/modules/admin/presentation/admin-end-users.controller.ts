import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import {
  AdminEndUserDetailSchema,
  AdminEndUserDeviceSchema,
  AdminEndUserListResponseSchema,
  AdminEndUserLimitsResponseSchema,
  AdminEndUserSessionListResponseSchema,
  AdminEndUserTimelineResponseSchema,
  ApplyUserTagsResponseSchema,
  BulkMessageResponseSchema,
  ChangeRequestSchema,
  type AdminEndUserDetail,
  type AdminEndUserDevice,
  type AdminEndUserLimitsResponse,
  type AdminEndUserListResponse,
  type AdminEndUserSessionListResponse,
  type AdminEndUserTimelineResponse,
  type ApplyUserTagsResponse,
  type BulkMessageResponse,
  type ChangeRequest,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { AdminEndUserService } from '../application/admin-end-user.service';
import { AdminUserSecurityService } from '../application/admin-user-security.service';
import { AdminUserBulkService } from '../application/admin-user-bulk.service';
import { AdminApprovalsService } from '../application/admin-approvals.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { sendCsvExport } from './csv-response';
import {
  AdminEndUserSearchQueryDto,
  AdminEndUserStatusDto,
  AdminEndUserTierDto,
  CreateManualCreditDto,
} from './dto/admin-end-user.dto';
import { AdminEndUsersExportQueryDto } from './dto/admin-export.dto';
import { ApplyUserTagsDto, BulkMessageDto } from './dto/admin-user-bulk.dto';

/** CSV header for the end-user export (matches AdminEndUserExportRow order). */
const USER_EXPORT_HEADER = [
  'id',
  'email',
  'displayName',
  'status',
  'kycStatus',
  'kycTier',
  'simSwapFlagged',
  'sanctionsFlagged',
  'balances',
  'ninLast4',
  'bvnLast4',
  'lastActiveAt',
  'createdAt',
] as const;

/**
 * Response shape for GET /admin/users/:id/devices — a thin list wrapper around
 * the shared device schema (no dedicated contract exists for the wrapper itself).
 */
const AdminEndUserDeviceListResponseSchema = z.object({
  devices: z.array(AdminEndUserDeviceSchema),
});
type AdminEndUserDeviceListResponse = {
  devices: AdminEndUserDevice[];
};

/**
 * ADM-02 platform end-user management (Phase 2, Task 5). NOTE: this manages the
 * platform's END USERS — distinct from AdminUsersController, which manages admin
 * console accounts. All routes are permissioned (default-deny via PermissionGuard);
 * every mutation additionally requires a fresh step-up. The service never moves
 * money (§3.1) and never reveals a PIN. Responses are parsed through their
 * contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminEndUsersController {
  constructor(
    private readonly users: AdminEndUserService,
    private readonly security: AdminUserSecurityService,
    private readonly bulk: AdminUserBulkService,
    private readonly approvals: AdminApprovalsService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  @RequirePermission('api_route', 'GET /admin/users', 'read')
  async list(
    @Query() query: AdminEndUserSearchQueryDto,
  ): Promise<AdminEndUserListResponse> {
    const result = await this.users.list(query);
    return AdminEndUserListResponseSchema.parse(result);
  }

  /**
   * CSV export of ALL end users matching the current filters (not just the
   * visible page). Same `read` permission as the list — an export reveals no
   * more than the on-screen table, and is PII-minimised (NIN/BVN last-4 only,
   * §3.4). Declared BEFORE `users/:id` so Express never matches `:id='export'`.
   * Records an `admin_export` audit event with the resulting rowCount.
   */
  @Get('users/export')
  @RequirePermission('api_route', 'GET /admin/users', 'read')
  async exportCsv(
    @Query() query: AdminEndUsersExportQueryDto,
    @CurrentAdmin() admin: AdminContext,
    @Res() res: Response,
  ): Promise<void> {
    const rows = await this.users.exportRows(query);
    await sendCsvExport({
      res,
      audit: this.audit,
      actorAdminId: admin.adminId,
      subject: 'users',
      header: USER_EXPORT_HEADER,
      rows: rows.map((r) => [
        r.id,
        r.email,
        r.displayName,
        r.status,
        r.kycStatus,
        r.kycTier,
        r.simSwapFlagged,
        r.sanctionsFlagged,
        r.balances,
        r.ninLast4,
        r.bvnLast4,
        r.lastActiveAt,
        r.createdAt,
      ]),
      filters: {
        query: query.query,
        status: query.status,
        kycStatus: query.kycStatus,
        kycTier: query.kycTier,
        includedIds: query.includedIds,
      },
    });
  }

  /**
   * Bulk-apply an operator TAG to the selected users. Step-up-guarded, permissioned
   * (Users:write), idempotent + audited. A tag is a pure annotation — it moves no
   * money and confers no authorization (§3.1).
   */
  @Post('users/tags')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/users/tags', 'write')
  async applyTags(
    @Body() body: ApplyUserTagsDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ApplyUserTagsResponse> {
    return ApplyUserTagsResponseSchema.parse(
      await this.bulk.applyTags(body, admin.adminId),
    );
  }

  /**
   * Bulk-queue a templated broadcast to the selected users. Step-up-guarded,
   * permissioned (Comms:write), idempotent + audited. Enqueues onto the notifications
   * outbox (never a direct send); the large-set gate is re-checked SERVER-SIDE (§3.3)
   * and moves no money (§3.1).
   */
  @Post('users/message')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/users/message', 'write')
  async queueMessage(
    @Body() body: BulkMessageDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<BulkMessageResponse> {
    return BulkMessageResponseSchema.parse(
      await this.bulk.queueMessage(body, admin.adminId),
    );
  }

  @Get('users/:id')
  @RequirePermission('api_route', 'GET /admin/users/:id', 'read')
  async get(@Param('id') id: string): Promise<AdminEndUserDetail> {
    return AdminEndUserDetailSchema.parse(await this.users.getDetail(id));
  }

  @Get('users/:id/sessions')
  @RequirePermission('api_route', 'GET /admin/users/:id/sessions', 'read')
  async listSessions(
    @Param('id') id: string,
  ): Promise<AdminEndUserSessionListResponse> {
    const sessions = await this.security.listSessions(id);
    return AdminEndUserSessionListResponseSchema.parse({ sessions });
  }

  @Get('users/:id/limits')
  @RequirePermission('api_route', 'GET /admin/users/:id/limits', 'read')
  async getLimits(
    @Param('id') id: string,
  ): Promise<AdminEndUserLimitsResponse> {
    return AdminEndUserLimitsResponseSchema.parse(
      await this.security.getLimits(id),
    );
  }

  @Get('users/:id/timeline')
  @RequirePermission('api_route', 'GET /admin/users/:id/timeline', 'read')
  async listTimeline(
    @Param('id') id: string,
  ): Promise<AdminEndUserTimelineResponse> {
    const entries = await this.security.listTimeline(id);
    return AdminEndUserTimelineResponseSchema.parse({ entries });
  }

  @Patch('users/:id/tier')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'PATCH /admin/users/:id/tier', 'write')
  async adjustTier(
    @Param('id') id: string,
    @Body() body: AdminEndUserTierDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.adjustTier(id, body.tier, admin.adminId);
  }

  @Patch('users/:id/status')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'PATCH /admin/users/:id/status', 'write')
  async setStatus(
    @Param('id') id: string,
    @Body() body: AdminEndUserStatusDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.setStatus(id, body.status, admin.adminId);
  }

  @Post('users/:id/pin-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/users/:id/pin-reset', 'write')
  async forcePinReset(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.forcePinReset(id, admin.adminId);
  }

  /**
   * Raise a MANUAL-CREDIT request for this user's wallet — a MAKER action only
   * (four-eyes, §3.1). This moves NO money: it records a pending `manual_credit`
   * ChangeRequest a SECOND admin must approve (via POST /admin/approvals/:id/approve,
   * which is step-up-guarded and routes the engine-brokered credit). The target
   * user is the path :id — never trusted from the body; asset/amount/reason come
   * from the validated body. Returns the created ChangeRequest (it enters the inbox).
   */
  @Post('users/:id/credit')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('api_route', 'POST /admin/users/:id/credit', 'write')
  async requestCredit(
    @Param('id') id: string,
    @Body() body: CreateManualCreditDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ChangeRequest> {
    const result = await this.approvals.create(
      {
        kind: 'manual_credit',
        resource: `User:${id}`,
        payload: { userId: id, asset: body.asset, amount: body.amount },
        reason: body.reason,
      },
      admin.adminId,
    );
    return ChangeRequestSchema.parse(result);
  }

  @Get('users/:id/devices')
  @RequirePermission('api_route', 'GET /admin/users/:id/devices', 'read')
  async listDevices(
    @Param('id') id: string,
  ): Promise<AdminEndUserDeviceListResponse> {
    const devices = await this.users.listDevices(id);
    return AdminEndUserDeviceListResponseSchema.parse({ devices });
  }

  @Delete('users/:id/devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'DELETE /admin/users/:id/devices/:deviceId',
    'write',
  )
  async revokeDevice(
    @Param('id') id: string,
    @Param('deviceId') deviceId: string,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.revokeDevice(id, deviceId, admin.adminId);
  }

  @Post('users/:id/sim-swap-reverify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/users/:id/sim-swap-reverify',
    'write',
  )
  async triggerSimSwapReverify(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.triggerSimSwapReverify(id, admin.adminId, new Date());
  }
}
