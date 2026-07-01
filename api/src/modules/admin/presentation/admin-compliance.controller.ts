import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  AmlRuleSchema,
  AmlRuleListResponseSchema,
  ComplianceEventDetailSchema,
  ComplianceEventListResponseSchema,
  ComplianceReportSchema,
  ComplianceReportListResponseSchema,
  SanctionsMonitoringViewSchema,
  SanctionsRecordListResponseSchema,
  TravelRuleListResponseSchema,
  type AmlRule,
  type AmlRuleListResponse,
  type ComplianceEventDetail,
  type ComplianceEventListResponse,
  type ComplianceReport,
  type ComplianceReportListResponse,
  type SanctionsMonitoringView,
  type SanctionsRecordListResponse,
  type TravelRuleListResponse,
} from '@handshake-agent/contracts';

import { AdminComplianceService } from '../application/admin-compliance.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  AmlRuleCreateDto,
  AmlRuleUpdateDto,
  ComplianceDispositionDto,
  ComplianceEventQueryDto,
  ComplianceFeedQueryDto,
  ComplianceReportDraftDto,
  ComplianceReportSubmitDto,
} from './dto/admin-compliance.dto';

/**
 * Phase 3 (sub-area C) — the admin COMPLIANCE CONSOLE. All routes are permissioned
 * (default-deny via PermissionGuard). The write/execute routes (event disposition,
 * AML-rule create/edit, report submit) additionally require a fresh step-up. The
 * service never moves money (§3.1) and holds no DB credentials (§3.2); responses
 * are parsed through their contract schema before leaving the boundary.
 */
@Controller('admin/compliance')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminComplianceController {
  constructor(private readonly compliance: AdminComplianceService) {}

  // ── flagged events ─────────────────────────────────────────────────────────

  @Get('events')
  @RequirePermission('api_route', 'GET /admin/compliance/events', 'read')
  async listEvents(
    @Query() query: ComplianceEventQueryDto,
  ): Promise<ComplianceEventListResponse> {
    return ComplianceEventListResponseSchema.parse(
      await this.compliance.listEvents(query),
    );
  }

  @Get('events/:id')
  @RequirePermission('api_route', 'GET /admin/compliance/events/:id', 'read')
  async getEvent(@Param('id') id: string): Promise<ComplianceEventDetail> {
    return ComplianceEventDetailSchema.parse(
      await this.compliance.getEvent(id),
    );
  }

  @Post('events/:id/disposition')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/compliance/events/:id/disposition',
    'write',
  )
  async dispose(
    @Param('id') id: string,
    @Body() dto: ComplianceDispositionDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ComplianceEventDetail> {
    return ComplianceEventDetailSchema.parse(
      await this.compliance.disposeEvent(id, dto, admin.adminId),
    );
  }

  // ── sanctions + travel rule (read-only) ─────────────────────────────────────

  @Get('sanctions')
  @RequirePermission('api_route', 'GET /admin/compliance/sanctions', 'read')
  async listSanctions(
    @Query() query: ComplianceFeedQueryDto,
  ): Promise<SanctionsRecordListResponse> {
    return SanctionsRecordListResponseSchema.parse(
      await this.compliance.listSanctions(query),
    );
  }

  @Get('travel-rule')
  @RequirePermission('api_route', 'GET /admin/compliance/travel-rule', 'read')
  async listTravelRule(
    @Query() query: ComplianceFeedQueryDto,
  ): Promise<TravelRuleListResponse> {
    return TravelRuleListResponseSchema.parse(
      await this.compliance.listTravelRule(query),
    );
  }

  @Get('monitoring')
  @RequirePermission('api_route', 'GET /admin/compliance/monitoring', 'read')
  getMonitoring(): SanctionsMonitoringView {
    return SanctionsMonitoringViewSchema.parse(this.compliance.getMonitoring());
  }

  // ── AML rules (CRUD) ────────────────────────────────────────────────────────

  @Get('aml-rules')
  @RequirePermission('api_route', 'GET /admin/compliance/aml-rules', 'read')
  async listAmlRules(): Promise<AmlRuleListResponse> {
    return AmlRuleListResponseSchema.parse(
      await this.compliance.listAmlRules(),
    );
  }

  @Post('aml-rules')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/compliance/aml-rules', 'write')
  async createAmlRule(
    @Body() dto: AmlRuleCreateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AmlRule> {
    return AmlRuleSchema.parse(
      await this.compliance.createAmlRule(dto, admin.adminId),
    );
  }

  @Patch('aml-rules/:id')
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'PATCH /admin/compliance/aml-rules/:id',
    'write',
  )
  async updateAmlRule(
    @Param('id') id: string,
    @Body() dto: AmlRuleUpdateDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AmlRule> {
    return AmlRuleSchema.parse(
      await this.compliance.updateAmlRule(id, dto, admin.adminId),
    );
  }

  // ── SAR/STR reports ─────────────────────────────────────────────────────────

  @Get('reports')
  @RequirePermission('api_route', 'GET /admin/compliance/reports', 'read')
  async listReports(): Promise<ComplianceReportListResponse> {
    return ComplianceReportListResponseSchema.parse(
      await this.compliance.listReports(),
    );
  }

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/compliance/reports', 'write')
  async draftReport(
    @Body() dto: ComplianceReportDraftDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ComplianceReport> {
    return ComplianceReportSchema.parse(
      await this.compliance.draftReport(dto, admin.adminId),
    );
  }

  @Post('reports/:id/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/compliance/reports/:id/submit',
    'execute',
  )
  async submitReport(
    @Param('id') id: string,
    @Body() dto: ComplianceReportSubmitDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ComplianceReport> {
    return ComplianceReportSchema.parse(
      await this.compliance.submitReport(id, dto.submissionRef, admin.adminId),
    );
  }
}
