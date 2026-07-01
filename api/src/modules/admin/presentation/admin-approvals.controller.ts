import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ChangeRequestInboxResponseSchema,
  ChangeRequestSchema,
  type ChangeRequest,
  type ChangeRequestInboxResponse,
} from '@handshake-agent/contracts';

import { AdminApprovalsService } from '../application/admin-approvals.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  CreateChangeRequestDto,
  RejectChangeRequestDto,
} from './dto/approvals.dto';

/**
 * Phase 7 — the maker-checker APPROVALS inbox + decisions. Every route is
 * permissioned (default-deny via PermissionGuard). The DECISION routes (approve /
 * reject) additionally require a fresh step-up — approve APPLIES a money/economics-
 * affecting change through the target service's atomic path (§3.1); the service
 * enforces four-eyes (the requester can never decide their own request) and holds
 * no DB credentials (§3.2). Responses are parsed through their contract schema
 * before leaving the boundary.
 */
@Controller('admin/approvals')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminApprovalsController {
  constructor(private readonly approvals: AdminApprovalsService) {}

  @Get('inbox')
  @RequirePermission('api_route', 'GET /admin/approvals/inbox', 'read')
  async inbox(
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ChangeRequestInboxResponse> {
    const result = await this.approvals.inbox(admin.adminId);
    return ChangeRequestInboxResponseSchema.parse(result);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('api_route', 'POST /admin/approvals', 'write')
  async create(
    @Body() dto: CreateChangeRequestDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ChangeRequest> {
    const result = await this.approvals.create(dto, admin.adminId);
    return ChangeRequestSchema.parse(result);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/approvals/:id/approve',
    'execute',
  )
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ChangeRequest> {
    const result = await this.approvals.approve(id, admin.adminId);
    return ChangeRequestSchema.parse(result);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/approvals/:id/reject', 'write')
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectChangeRequestDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ChangeRequest> {
    const result = await this.approvals.reject(id, admin.adminId, dto.reason);
    return ChangeRequestSchema.parse(result);
  }
}
