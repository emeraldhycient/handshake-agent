import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  PermissionListResponseSchema,
  RoleListResponseSchema,
  RoleSchema,
  type PermissionListResponse,
  type Role,
  type RoleListResponse,
} from '@handshake-agent/contracts';

import { PermissionCatalogService } from '../application/permission-catalog.service';
import { RoleService } from '../application/role.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { RoleCreateDto, RoleUpdateDto } from './dto/admin-role.dto';

/**
 * Role & permission-catalog management (ADM-03 / ADM-04). All routes are
 * permissioned (default-deny). Built-in roles are immutable — the service raises
 * BuiltinRoleImmutableError, mapped to 409 by the global filter.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminRolesController {
  constructor(
    private readonly roles: RoleService,
    private readonly permissions: PermissionCatalogService,
  ) {}

  @Get('roles')
  @RequirePermission('api_route', 'GET /admin/roles', 'read')
  async listRoles(): Promise<RoleListResponse> {
    const roles = await this.roles.list();
    return RoleListResponseSchema.parse({ roles });
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('api_route', 'POST /admin/roles', 'write')
  async createRole(
    @Body() dto: RoleCreateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<Role> {
    const role = await this.roles.create(dto, admin.adminId);
    return RoleSchema.parse({
      id: role.id,
      name: role.name,
      description: role.description,
      isBuiltin: role.isBuiltin,
      permissionIds: dto.permissionIds,
    });
  }

  @Patch('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('api_route', 'PATCH /admin/roles/:id', 'write')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: RoleUpdateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.roles.update(id, dto, admin.adminId);
  }

  @Get('permissions')
  @RequirePermission('api_route', 'GET /admin/permissions', 'read')
  async listPermissions(): Promise<PermissionListResponse> {
    const permissions = await this.permissions.list();
    return PermissionListResponseSchema.parse({ permissions });
  }
}
