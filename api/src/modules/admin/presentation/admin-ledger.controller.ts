import {
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
  AdminLedgerHistoryResponseSchema,
  AdminLedgerIntegrityResultSchema,
  AdminLedgerIntegritySummarySchema,
  AdminLedgerListResponseSchema,
  type AdminLedgerHistoryResponse,
  type AdminLedgerIntegrityResult,
  type AdminLedgerIntegritySummary,
  type AdminLedgerListResponse,
} from '@handshake-agent/contracts';

import { AdminLedgerService } from '../application/admin-ledger.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import {
  AdminLedgerHistoryQueryDto,
  AdminLedgerListQueryDto,
} from './dto/admin-txn.dto';

/**
 * Phase 3 (sub-area A) — READ-ONLY ledger oversight. All routes are permissioned
 * (default-deny via PermissionGuard). The integrity verify is `execute` because
 * it runs a computation, but it NEVER mutates the append-only ledger — it only
 * re-sums existing legs (§3.1). Responses are parsed through their contract
 * schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminLedgerController {
  constructor(private readonly ledger: AdminLedgerService) {}

  /**
   * GLOBAL cross-account browse (Phase 6b): legs across ALL accounts filtered by
   * an optional accountType and/or currency, newest-first, keyset-paginated. This
   * is a distinct static route from the account-scoped `GET /admin/ledger` below.
   */
  @Get('ledger/all')
  @RequirePermission('api_route', 'GET /admin/ledger/all', 'read')
  async listGlobal(
    @Query() query: AdminLedgerListQueryDto,
  ): Promise<AdminLedgerListResponse> {
    return AdminLedgerListResponseSchema.parse(
      await this.ledger.listGlobal(query),
    );
  }

  /**
   * GLOBAL sequence-integrity summary (Phase 6b): walks every sub-ledger's
   * sequence for gaps/reorders. Feeds the header integrity pill. READ-ONLY (§3.1).
   */
  @Get('ledger/integrity')
  @RequirePermission('api_route', 'GET /admin/ledger/integrity', 'read')
  async integrity(): Promise<AdminLedgerIntegritySummary> {
    return AdminLedgerIntegritySummarySchema.parse(
      await this.ledger.verifyGlobalSequenceIntegrity(),
    );
  }

  @Get('ledger')
  @RequirePermission('api_route', 'GET /admin/ledger', 'read')
  async history(
    @Query() query: AdminLedgerHistoryQueryDto,
  ): Promise<AdminLedgerHistoryResponse> {
    const entries = await this.ledger.getAccountHistory(
      query.accountType,
      query.accountId,
      query.currency,
      query.limit,
    );
    return AdminLedgerHistoryResponseSchema.parse({ entries });
  }

  @Post('ledger/verify/:transactionId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(
    'api_route',
    'POST /admin/ledger/verify/:transactionId',
    'execute',
  )
  async verify(
    @Param('transactionId') transactionId: string,
  ): Promise<AdminLedgerIntegrityResult> {
    return AdminLedgerIntegrityResultSchema.parse(
      await this.ledger.verifyTransactionIntegrity(transactionId),
    );
  }
}
