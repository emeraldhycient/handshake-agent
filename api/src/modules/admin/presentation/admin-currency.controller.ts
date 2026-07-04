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
  AdminCustomFiatListResponseSchema,
  AdminCustomFiatSchema,
  type AdminCustomFiat,
  type AdminCustomFiatListResponse,
} from '@handshake-agent/contracts';

import { AdminCurrencyService } from '../application/admin-currency.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  AdminCustomFiatCreateDto,
  AdminCustomFiatUpdateDto,
} from './dto/admin-currency.dto';

/**
 * Runtime "Add currency" surface (CLAUDE.md §7). Lists the custom currencies (read),
 * adds one (write, step-up-gated, created DISABLED), and enables/disables or edits one
 * (write, step-up-gated). Permissioned (default-deny via PermissionGuard) under the
 * Config category. A custom currency moves NO money (§3.1) — it is a catalog entry;
 * enabling is fail-closed server-side (needs pricing, §3.3). Both writes carry the
 * authenticated actor via `@CurrentAdmin` (never a body param) and are immutably audited
 * inside the service, which also republishes the money-path overlay. Responses are
 * parsed through their contract schema before the boundary. The `:code` param is
 * upper-cased so it matches the stored (upper-case) currency code.
 */
@Controller('admin/config/currencies')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminCurrencyController {
  constructor(private readonly currencies: AdminCurrencyService) {}

  // ── list (read) ───────────────────────────────────────────────────────────────

  @Get()
  @RequirePermission('api_route', 'GET /admin/config/currencies', 'read')
  async list(): Promise<AdminCustomFiatListResponse> {
    return AdminCustomFiatListResponseSchema.parse(
      await this.currencies.list(),
    );
  }

  // ── add (write — step-up-gated) ─────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/config/currencies', 'write')
  async add(
    @Body() dto: AdminCustomFiatCreateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminCustomFiat> {
    return AdminCustomFiatSchema.parse(
      await this.currencies.add(
        {
          code: dto.code,
          displayName: dto.displayName,
          symbol: dto.symbol,
          decimals: dto.decimals,
        },
        admin.adminId,
      ),
    );
  }

  // ── enable/disable or edit (write — step-up-gated) ──────────────────────────────

  @Patch(':code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'PATCH /admin/config/currencies/:code',
    'write',
  )
  async update(
    @Param('code') code: string,
    @Body() dto: AdminCustomFiatUpdateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminCustomFiat> {
    return AdminCustomFiatSchema.parse(
      await this.currencies.update(
        code.toUpperCase(),
        {
          ...(dto.enabled !== undefined && { enabled: dto.enabled }),
          ...(dto.displayName !== undefined && {
            displayName: dto.displayName,
          }),
          ...(dto.symbol !== undefined && { symbol: dto.symbol }),
          ...(dto.decimals !== undefined && { decimals: dto.decimals }),
        },
        admin.adminId,
      ),
    );
  }
}
