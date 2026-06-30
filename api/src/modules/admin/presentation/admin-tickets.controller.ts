import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import {
  TicketOrderListResponseSchema,
  type TicketOrderListResponse,
} from '@handshake-agent/contracts';

import { AdminTicketService } from '../application/admin-ticket.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AdminPaginationQueryDto } from './dto/admin-pagination.dto';

/**
 * Phase 4 (wave 2) — READ-ONLY ticket-order oversight. Permissioned (default-deny);
 * no write path (enablement + commission are edited via /admin/settings). The
 * service never moves money (§3.1) and holds no DB credentials (§3.2). The response
 * is parsed through its contract schema before it leaves the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminTicketsController {
  constructor(private readonly tickets: AdminTicketService) {}

  @Get('tickets/orders')
  @RequirePermission('api_route', 'GET /admin/tickets/orders', 'read')
  async listOrders(
    @Query() query: AdminPaginationQueryDto,
  ): Promise<TicketOrderListResponse> {
    const result = await this.tickets.listOrders(query);
    return TicketOrderListResponseSchema.parse(result);
  }
}
