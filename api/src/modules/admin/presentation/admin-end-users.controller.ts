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
  AdminUserNoteListResponseSchema,
  AdminUserNoteSchema,
  ApplyUserTagsResponseSchema,
  BulkMessageResponseSchema,
  ChangeRequestSchema,
  type AdminEndUserDetail,
  type AdminEndUserDevice,
  type AdminEndUserLimitsResponse,
  type AdminEndUserListResponse,
  type AdminEndUserSessionListResponse,
  type AdminEndUserTimelineResponse,
  type AdminUserNote,
  type AdminUserNoteListResponse,
  type ApplyUserTagsResponse,
  type BulkMessageResponse,
  type ChangeRequest,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { AdminEndUserService } from '../application/admin-end-user.service';
import { AdminUserSecurityService } from '../application/admin-user-security.service';
import { AdminUserBulkService } from '../application/admin-user-bulk.service';
import { AdminUserNoteService } from '../application/admin-user-note.service';
import { AdminResendVerificationService } from '../application/admin-resend-verification.service';
import { AdminApprovalsService } from '../application/admin-approvals.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { sendCsvExport } from './csv-response';
import {
  AdminEndUserLimitsQueryDto,
  AdminEndUserSearchQueryDto,
  AdminEndUserStatusDto,
  AdminEndUserTierDto,
  CreateManualCreditDto,
  ForceReKycDto,
  ResendVerificationDto,
} from './dto/admin-end-user.dto';
import { AdminEndUsersExportQueryDto } from './dto/admin-export.dto';
import { ApplyUserTagsDto, BulkMessageDto } from './dto/admin-user-bulk.dto';
import { AdminUserNoteCreateDto } from './dto/admin-user-note.dto';
import { AdminUserSessionRevokeDto } from './dto/admin-user-session.dto';

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
    private readonly notes: AdminUserNoteService,
    private readonly resendVerification: AdminResendVerificationService,
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

  /**
   * Force sign-out of ALL the user's live auth sessions in one action (e.g. an
   * account-takeover response). Step-up-guarded, permissioned (Users:write), and
   * immutably audited (`session_revoke` against `User:<id>`) with the operator's
   * reason. Sessions are marked revoked (never deleted — retained for audit); it
   * is idempotent (zero live sessions → still 204). Moves no money (§3.1); the
   * subject is the opaque :id only, re-checked server-side (§3.3, 404 on unknown).
   * Declared BEFORE the `:sessionId` route so Express never treats a bare DELETE
   * on the collection as `:sessionId` = undefined.
   */
  @Delete('users/:id/sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'DELETE /admin/users/:id/sessions', 'write')
  async revokeAllSessions(
    @Param('id') id: string,
    @Body() body: AdminUserSessionRevokeDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.security.revokeAllSessions(id, body.reason, admin.adminId);
  }

  /**
   * Force sign-out of a SINGLE session (e.g. a device the user reports as
   * compromised). Same guards/audit as the all-sessions route; the revoke is
   * scoped SERVER-SIDE to the path user, so an admin can never revoke another
   * user's session by id. An unknown/foreign/already-revoked session id fails
   * closed as 404 (§3.6) — a no-op is never a silent success on this surface.
   */
  @Delete('users/:id/sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'DELETE /admin/users/:id/sessions/:sessionId',
    'write',
  )
  async revokeSession(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() body: AdminUserSessionRevokeDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.security.revokeSession(
      id,
      sessionId,
      body.reason,
      admin.adminId,
    );
  }

  @Get('users/:id/limits')
  @RequirePermission('api_route', 'GET /admin/users/:id/limits', 'read')
  async getLimits(
    @Param('id') id: string,
    @Query() query: AdminEndUserLimitsQueryDto,
  ): Promise<AdminEndUserLimitsResponse> {
    return AdminEndUserLimitsResponseSchema.parse(
      await this.security.getLimits(id, query.currency),
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

  /**
   * List a user's operator notes, newest-first. A pure read of case annotations —
   * permissioned (Users:read), never audited (a read is not a mutation). No PII
   * beyond the operator's free text; the owning userId stays server-side (§3.4).
   */
  @Get('users/:id/notes')
  @RequirePermission('api_route', 'GET /admin/users/:id/notes', 'read')
  async listNotes(@Param('id') id: string): Promise<AdminUserNoteListResponse> {
    return AdminUserNoteListResponseSchema.parse(await this.notes.list(id));
  }

  /**
   * Append an immutable operator note to this user's timeline. Permissioned
   * (Users:write) + immutably audited (`admin_update` against `User:<id>`). The
   * target user is the path :id — never trusted from the body; the author is the
   * authenticated admin. A note is a pure annotation: it moves no money and confers
   * no authorization (§3.1).
   */
  @Post('users/:id/notes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('api_route', 'POST /admin/users/:id/notes', 'write')
  async createNote(
    @Param('id') id: string,
    @Body() body: AdminUserNoteCreateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminUserNote> {
    return AdminUserNoteSchema.parse(
      await this.notes.create(id, body.body, admin.adminId),
    );
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

  /**
   * Force re-KYC: reset the user to a pending KYC state so re-verification is
   * required — e.g. after a SIM-swap or identity concern (§3.4). Step-up-guarded,
   * permissioned (Users:write), and audited with the operator's reason. Moves no
   * money (§3.1); no PII crosses this path — the subject is the opaque :id only.
   */
  @Post('users/:id/force-rekyc')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/users/:id/force-rekyc', 'write')
  async forceReKyc(
    @Param('id') id: string,
    @Body() body: ForceReKycDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.forceReKyc(id, body.reason, admin.adminId);
  }

  /**
   * Re-send the user's onboarding/verification nudge (e.g. the email never
   * arrived). LOW-RISK: permissioned (Users:write) + audited, but NO step-up —
   * a resend is a courtesy action and the reason is OPTIONAL. Enqueues onto the
   * notifications OUTBOX (never a direct provider send); the dispatch worker
   * sends it. Moves no money (§3.1); the subject is the opaque :id only, and the
   * user is re-checked server-side (§3.3, 404 on an unknown id).
   */
  @Post('users/:id/resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(
    'api_route',
    'POST /admin/users/:id/resend-verification',
    'write',
  )
  async resendVerificationEmail(
    @Param('id') id: string,
    @Body() body: ResendVerificationDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.resendVerification.resend(id, admin.adminId, body.reason);
  }
}
