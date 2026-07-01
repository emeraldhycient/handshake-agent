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

import { AuditService } from '../../../core/audit/application/audit.service';
import type {
  AuditListQuery,
  AuditLogRecord,
} from '../../../core/audit/application/ports/audit-log.repository.port';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AuditLogQueryDto } from './dto/admin-list-query.dto';

/** Serialize a stored audit record into the contract entry shape. */
function toEntry(record: AuditLogRecord): unknown {
  return {
    id: record.id,
    correlationId: record.correlationId,
    actor: record.actor,
    actorAdminId: record.actorAdminId,
    actorUserId: record.actorUserId,
    subject: record.subject,
    action: record.action,
    details: record.details,
    before: record.before,
    after: record.after,
    currentHash: record.currentHash,
    prevHash: record.prevHash,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Audit-log read + chain verification (AUD-01). Permissioned (default-deny):
 * read requires Audit:read, verify requires Audit:execute. The hash-chained log
 * is append-only — there is no mutation endpoint by design.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

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
    const result = await this.audit.list(repoQuery);
    return AuditLogListResponseSchema.parse({
      items: result.items.map(toEntry),
      nextCursor: result.nextCursor,
    });
  }

  @Post('audit/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('api_route', 'POST /admin/audit/verify', 'execute')
  async verify(): Promise<AuditChainVerifyResponse> {
    const result = await this.audit.verifyChain();
    return AuditChainVerifyResponseSchema.parse(result);
  }
}
