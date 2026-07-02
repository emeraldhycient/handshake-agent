import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import {
  AgentConfigViewSchema,
  AgentInsightsViewSchema,
  ConversationLogDetailSchema,
  ConversationLogListResponseSchema,
  type AgentConfigView,
  type AgentInsightsView,
  type ConversationLogDetail,
  type ConversationLogListResponse,
} from '@handshake-agent/contracts';

import { AdminAgentService } from '../application/admin-agent.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AdminPaginationQueryDto } from './dto/admin-pagination.dto';

/**
 * Phase 4 (wave 2) — READ-ONLY admin Agent console. Permissioned (default-deny);
 * NO write path. The model id + enablement are edited via /admin/settings; the
 * system prompt is read-only and never editable (§3.1/§6), and the ANTHROPIC_API_KEY
 * is NEVER surfaced. The service never moves money (§3.1) and holds no DB
 * credentials (§3.2). Responses are parsed through their contract schema first.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminAgentController {
  constructor(private readonly agent: AdminAgentService) {}

  @Get('agent/config')
  @RequirePermission('api_route', 'GET /admin/agent/config', 'read')
  getConfig(): AgentConfigView {
    return AgentConfigViewSchema.parse(this.agent.getConfig());
  }

  @Get('agent/insights')
  @RequirePermission('api_route', 'GET /admin/agent/insights', 'read')
  async getInsights(): Promise<AgentInsightsView> {
    return AgentInsightsViewSchema.parse(await this.agent.getInsights());
  }

  @Get('agent/conversations')
  @RequirePermission('api_route', 'GET /admin/agent/conversations', 'read')
  async listConversations(
    @Query() query: AdminPaginationQueryDto,
  ): Promise<ConversationLogListResponse> {
    const result = await this.agent.listConversations(query);
    return ConversationLogListResponseSchema.parse(result);
  }

  @Get('agent/conversations/:id')
  @RequirePermission('api_route', 'GET /admin/agent/conversations/:id', 'read')
  async getConversation(
    @Param('id') id: string,
  ): Promise<ConversationLogDetail> {
    return ConversationLogDetailSchema.parse(
      await this.agent.getConversation(id),
    );
  }
}
