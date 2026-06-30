import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  AdminInvitationCreateResponseSchema,
  AdminUserListResponseSchema,
  AdminUserSchema,
  type AdminInvitationCreateResponse,
  type AdminUser,
  type AdminUserListResponse,
} from '@handshake-agent/contracts';

import { AdminInvitationService } from '../application/admin-invitation.service';
import { AdminUserService } from '../application/admin-user.service';
import type { AdminUserRecord } from '../application/ports/admin-user.repository.port';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { AdminUserListQueryDto } from './dto/admin-list-query.dto';
import { AdminInvitationCreateDto } from './dto/admin-invitation.dto';
import { AdminUserRoleDto, AdminUserStatusDto } from './dto/admin-user.dto';

/** Serialize an admin-user record into the contract shape (Dates → ISO strings). */
function toAdminUser(record: AdminUserRecord): AdminUser {
  return AdminUserSchema.parse({
    id: record.id,
    email: record.email,
    status: record.status,
    mfaEnabled: record.mfaEnabled,
    role: { id: record.roleId, name: record.roleName },
    createdAt: record.createdAt.toISOString(),
    lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
  });
}

/**
 * Admin user management + invitations (ADM-01 / ADM-07). All routes are
 * permissioned (default-deny via PermissionGuard); role/status mutations
 * additionally require a fresh step-up. Responses are parsed through their
 * contract schemas before leaving the controller.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUserService,
    private readonly invitations: AdminInvitationService,
  ) {}

  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('api_route', 'POST /admin/invitations', 'write')
  async invite(
    @Body() dto: AdminInvitationCreateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminInvitationCreateResponse> {
    const result = await this.invitations.create(
      dto,
      admin.adminId,
      new Date(),
    );
    return AdminInvitationCreateResponseSchema.parse({
      id: result.id,
      email: result.email,
      expiresAt: result.expiresAt.toISOString(),
      invitationToken: result.invitationToken,
    });
  }

  @Get('admins')
  @RequirePermission('api_route', 'GET /admin/admins', 'read')
  async list(
    @Query() query: AdminUserListQueryDto,
  ): Promise<AdminUserListResponse> {
    const result = await this.users.list(query);
    return AdminUserListResponseSchema.parse({
      items: result.items.map(toAdminUser),
      nextCursor: result.nextCursor,
    });
  }

  @Get('admins/:id')
  @RequirePermission('api_route', 'GET /admin/admins/:id', 'read')
  async get(@Param('id') id: string): Promise<AdminUser> {
    return toAdminUser(await this.users.get(id));
  }

  @Patch('admins/:id/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('api_route', 'PATCH /admin/admins/:id/role', 'write')
  @UseGuards(AdminStepUpGuard)
  async updateRole(
    @Param('id') id: string,
    @Body() dto: AdminUserRoleDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.updateRole(id, dto.roleId, admin.adminId, new Date());
  }

  @Patch('admins/:id/status')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('api_route', 'PATCH /admin/admins/:id/status', 'write')
  @UseGuards(AdminStepUpGuard)
  async setStatus(
    @Param('id') id: string,
    @Body() dto: AdminUserStatusDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.users.setStatus(id, dto.status, admin.adminId, new Date());
  }
}
