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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import {
  AdminEndUserDetailSchema,
  AdminEndUserDeviceSchema,
  AdminEndUserListResponseSchema,
  type AdminEndUserDetail,
  type AdminEndUserDevice,
  type AdminEndUserListResponse,
} from '@handshake-agent/contracts';

import { AdminEndUserService } from '../application/admin-end-user.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  AdminEndUserSearchQueryDto,
  AdminEndUserStatusDto,
  AdminEndUserTierDto,
} from './dto/admin-end-user.dto';

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
  constructor(private readonly users: AdminEndUserService) {}

  @Get('users')
  @RequirePermission('api_route', 'GET /admin/users', 'read')
  async list(
    @Query() query: AdminEndUserSearchQueryDto,
  ): Promise<AdminEndUserListResponse> {
    const result = await this.users.list(query);
    return AdminEndUserListResponseSchema.parse(result);
  }

  @Get('users/:id')
  @RequirePermission('api_route', 'GET /admin/users/:id', 'read')
  async get(@Param('id') id: string): Promise<AdminEndUserDetail> {
    return AdminEndUserDetailSchema.parse(await this.users.getDetail(id));
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
