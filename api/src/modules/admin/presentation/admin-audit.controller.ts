import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  AuditChainVerifyResponseSchema,
  AuditLogListResponseSchema,
  type AuditChainVerifyResponse,
  type AuditLogListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import type { AuditListQuery } from '../../../core/audit/application/ports/audit-log.repository.port';
import { AdminAuditService } from '../application/admin-audit.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { sendCsvExport } from './csv-response';
import { AuditLogQueryDto } from './dto/admin-list-query.dto';
import { AuditLogExportQueryDto } from './dto/admin-export.dto';

/** CSV header for the audit-log export (matches AuditLogEntry column order). */
const AUDIT_EXPORT_HEADER = [
  'id',
  'createdAt',
  'actor',
  'actorRole',
  'subject',
  'action',
  'reason',
  'correlationId',
  'currentHash',
  'prevHash',
] as const;

/** Build the repository query (string dates → Date) from the audit filter DTO. */
function toAuditListQuery(query: {
  actorAdminId?: string;
  subject?: string;
  action?: AuditListQuery['action'];
  from?: string;
  to?: string;
}): AuditListQuery {
  return {
    actorAdminId: query.actorAdminId,
    subject: query.subject,
    action: query.action,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
}

/**
 * Audit-log read + chain verification (AUD-01). Permissioned (default-deny):
 * read requires Audit:read, verify requires Audit:execute. The hash-chained log
 * is append-only — there is no mutation endpoint by design. Read enrichment
 * (per-actor role + projected reason) is done in {@link AdminAuditService}.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminAuditController {
  constructor(
    private readonly audit: AdminAuditService,
    private readonly auditLog: AuditService,
  ) {}

  /**
   * CSV export of ALL audit rows matching the current filters (not just the
   * visible page), each enriched with actorRole + projected reason. Same `read`
   * permission as the list. Declared BEFORE `GET /admin/audit` — a static path,
   * no `:id` conflict. Records an `admin_export` audit event with the rowCount.
   */
  @Get('audit/export')
  @RequirePermission('api_route', 'GET /admin/audit', 'read')
  async exportCsv(
    @Query() query: AuditLogExportQueryDto,
    @CurrentAdmin() admin: AdminContext,
    @Res() res: Response,
  ): Promise<void> {
    const rows = await this.audit.exportRows(toAuditListQuery(query));
    await sendCsvExport({
      res,
      audit: this.auditLog,
      actorAdminId: admin.adminId,
      subject: 'audit',
      header: AUDIT_EXPORT_HEADER,
      rows: rows.map((r) => [
        r.id,
        r.createdAt,
        r.actor,
        r.actorRole,
        r.subject,
        r.action,
        r.reason,
        r.correlationId,
        r.currentHash,
        r.prevHash,
      ]),
      filters: {
        actorAdminId: query.actorAdminId,
        subject: query.subject,
        action: query.action,
        from: query.from,
        to: query.to,
      },
    });
  }

  @Get('audit')
  @RequirePermission('api_route', 'GET /admin/audit', 'read')
  async list(@Query() query: AuditLogQueryDto): Promise<AuditLogListResponse> {
    const repoQuery: AuditListQuery = {
      ...toAuditListQuery(query),
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
