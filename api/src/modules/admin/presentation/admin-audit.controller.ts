import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  AuditChainVerifyResponseSchema,
  AuditLogListResponseSchema,
  type AuditChainVerifyResponse,
  type AuditLogListResponse,
} from '@handshake-agent/contracts';

import type { AuditListQuery } from '../../../core/audit/application/ports/audit-log.repository.port';
import { AdminAuditService } from '../application/admin-audit.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AuditLogQueryDto } from './dto/admin-list-query.dto';

/**
 * Audit-log read + chain verification (AUD-01). Permissioned (default-deny):
 * read requires Audit:read, verify requires Audit:execute. The hash-chained log
 * is append-only — there is no mutation endpoint by design. Read enrichment
 * (per-actor role + projected reason) is done in {@link AdminAuditService}.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get('audit')
  @RequirePermission('api_route', 'GET /admin/audit', 'read')
  async list(@Query() query: AuditLogQueryDto): Promise<AuditLogListResponse> {
    const repoQuery: AuditListQuery = {
      actorAdminId: query.actorAdminId,
      subject: query.subject,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor,
      limit: query.limit,
    };
    return AuditLogListResponseSchema.parse(await this.audit.list(repoQuery));
  }

  @Post('audit/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('api_route', 'POST /admin/audit/verify', 'execute')
  async verify(): Promise<AuditChainVerifyResponse> {
    const result = await this.audit.verifyChain();
    return AuditChainVerifyResponseSchema.parse(result);
  }
}
