import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  BlockedEntryListResponseSchema,
  BlockedEntrySchema,
  type BlockedEntry,
  type BlockedEntryListResponse,
} from '@handshake-agent/contracts';

import { AdminBlockedListService } from '../application/admin-blocked-list.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  BlockedEntryCreateDto,
  BlockedEntrySupersedeDto,
} from './dto/admin-blocked.dto';

/**
 * ADM Phase 9 — the APPEND-ONLY admin deny-list surface. Lists the ACTIVE blocked
 * entries (read), adds a block (write, step-up-gated), and LIFTS a block by
 * superseding its row (write, step-up-gated). Permissioned (default-deny via
 * PermissionGuard) under the Compliance category. A block moves no money (§3.1) — it
 * is a gate; lifting a block never deletes the row (append-only, §3.4). Both writes
 * carry the authenticated actor via `@CurrentAdmin` (never a body param) and are
 * immutably audited inside the service. Responses are parsed through their contract
 * schema before the boundary.
 */
@Controller('admin/blocked')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminBlockedController {
  constructor(private readonly blocked: AdminBlockedListService) {}

  // ── list (read) ───────────────────────────────────────────────────────────────

  @Get()
  @RequirePermission('api_route', 'GET /admin/blocked', 'read')
  async list(): Promise<BlockedEntryListResponse> {
    return BlockedEntryListResponseSchema.parse(await this.blocked.list());
  }

  // ── add (write — step-up-gated) ─────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/blocked', 'write')
  async add(
    @Body() dto: BlockedEntryCreateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<BlockedEntry> {
    return BlockedEntrySchema.parse(
      await this.blocked.add(
        { kind: dto.kind, value: dto.value, reason: dto.reason },
        admin.adminId,
      ),
    );
  }

  // ── supersede / lift (write — step-up-gated) ────────────────────────────────────

  @Post(':id/supersede')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/blocked/:id/supersede', 'write')
  async supersede(
    @Param('id') id: string,
    @Body() dto: BlockedEntrySupersedeDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<BlockedEntry> {
    return BlockedEntrySchema.parse(
      await this.blocked.supersede(id, dto.reason, admin.adminId),
    );
  }
}
