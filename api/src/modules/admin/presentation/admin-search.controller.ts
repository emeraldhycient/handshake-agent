import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import {
  AdminSearchQuerySchema,
  AdminSearchResponseSchema,
  type AdminSearchResponse,
} from '@handshake-agent/contracts';

import { AdminSearchService } from '../application/admin-search.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

class AdminSearchQueryDto extends createZodDto(AdminSearchQuerySchema) {}

/**
 * Global admin search (go-readiness #14) — powers the ⌘K header palette's live
 * entity lookup (users + transactions). Permissioned (default-deny) + READ-ONLY:
 * every result is an in-app href; nothing here moves money (§3.1). The response is
 * parsed through its contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminSearchController {
  constructor(private readonly search: AdminSearchService) {}

  @Get('search')
  @RequirePermission('api_route', 'GET /admin/search', 'read')
  async run(@Query() query: AdminSearchQueryDto): Promise<AdminSearchResponse> {
    return AdminSearchResponseSchema.parse(await this.search.search(query.q));
  }
}
