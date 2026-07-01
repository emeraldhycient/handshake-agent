import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import {
  AdminTxnDetailSchema,
  AdminTxnListResponseSchema,
  type AdminTxnDetail,
  type AdminTxnListResponse,
} from '@handshake-agent/contracts';

import { AdminTxnOversightService } from '../application/admin-txn-oversight.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AdminTxnSearchQueryDto } from './dto/admin-txn.dto';

/**
 * Phase 3 (sub-area A) — READ-ONLY transactions oversight. All routes are
 * permissioned (default-deny via PermissionGuard). The service never moves money
 * (§3.1) and holds no DB credentials (§3.2). Responses are parsed through their
 * contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminTransactionsController {
  constructor(private readonly oversight: AdminTxnOversightService) {}

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
}
