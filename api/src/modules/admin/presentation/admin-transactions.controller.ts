import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  AdminTxnDetailSchema,
  AdminTxnListResponseSchema,
  ReconBreakListResponseSchema,
  type AdminTxnDetail,
  type AdminTxnListResponse,
  type ReconBreakListResponse,
} from '@handshake-agent/contracts';

import { AdminTxnOversightService } from '../application/admin-txn-oversight.service';
import { AdminTxnTriageService } from '../application/admin-txn-triage.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { AdminTxnSearchQueryDto, TxnRerunReconDto } from './dto/admin-txn.dto';

/**
 * Phase 3 (sub-area A) — READ-ONLY transactions oversight + the Phase-8 per-transaction
 * re-run reconciliation. All routes are permissioned (default-deny via PermissionGuard).
 * Neither the oversight read nor the reconcile re-run moves money (§3.1) — the reconcile
 * endpoint is READ-ONLY provider-vs-ledger DETECTION (distinct from the money-path
 * mark-failed/retry on AdminTxnTriageController). Services hold no DB credentials (§3.2).
 * Responses are parsed through their contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminTransactionsController {
  constructor(
    private readonly oversight: AdminTxnOversightService,
    private readonly triage: AdminTxnTriageService,
  ) {}

  @Get('transactions')
  @RequirePermission('api_route', 'GET /admin/transactions', 'read')
  async list(
    @Query() query: AdminTxnSearchQueryDto,
  ): Promise<AdminTxnListResponse> {
    const result = await this.oversight.list(query);
    return AdminTxnListResponseSchema.parse(result);
  }

  @Get('transactions/:id')
  @RequirePermission('api_route', 'GET /admin/transactions/:id', 'read')
  async get(@Param('id') id: string): Promise<AdminTxnDetail> {
    return AdminTxnDetailSchema.parse(await this.oversight.getDetail(id));
  }

  // ── re-run reconciliation (Phase 8, READ-ONLY detection — no step-up, no money) ──

  @Post('transactions/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(
    'api_route',
    'POST /admin/transactions/:id/reconcile',
    'write',
  )
  async reconcile(
    @Param('id') id: string,
    @Body() dto: TxnRerunReconDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ReconBreakListResponse> {
    return ReconBreakListResponseSchema.parse(
      await this.triage.rerunReconciliation(id, admin.adminId, dto.reason),
    );
  }
}
