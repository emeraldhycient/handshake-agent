import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  UseGuards,
} from '@nestjs/common';

import {
  type AdminSessionView,
  AdminSessionListResponseSchema,
  type AdminSessionListResponse,
} from '@handshake-agent/contracts';

import {
  ADMIN_SESSION_REPOSITORY,
  type AdminSessionRecord,
  type IAdminSessionRepository,
} from '../application/ports/admin-session.repository.port';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';

function toView(record: AdminSessionRecord): AdminSessionView {
  return {
    id: record.id,
    expiresAt: record.expiresAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
    stepUpCompletedAt: record.stepUpCompletedAt?.toISOString() ?? null,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
  };
}

/**
 * Admin session management (ADM-08). Lists the current admin's own sessions and
 * revokes a session by id. Permissioned (default-deny). The token hash is never
 * surfaced — only metadata is returned.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminSessionsController {
  constructor(
    @Inject(ADMIN_SESSION_REPOSITORY)
    private readonly sessions: IAdminSessionRepository,
  ) {}

  @Get('sessions')
  @RequirePermission('api_route', 'GET /admin/sessions', 'read')
  async list(
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminSessionListResponse> {
    const records = await this.sessions.listForAdmin(admin.adminId);
    return AdminSessionListResponseSchema.parse({ items: records.map(toView) });
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('api_route', 'DELETE /admin/sessions/:id', 'write')
  async revoke(@Param('id') id: string): Promise<void> {
    await this.sessions.revoke(id, new Date());
  }
}
