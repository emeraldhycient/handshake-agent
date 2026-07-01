import { Controller, Get, UseGuards } from '@nestjs/common';

import { MetricsOpsSchema, type MetricsOps } from '@handshake-agent/contracts';

import { AdminMetricsOpsService } from '../application/admin-metrics-ops.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * Phase 6b — READ-ONLY operational-health metrics for the operator dashboard's
 * three still-mock panels: System health (per-provider dispatch status +
 * webhook-queue depth + recon drift), the Live-activity feed, and the Open
 * compliance-cases count. Permissioned (default-deny via PermissionGuard) under
 * the existing `Metrics` category. Nothing here moves money (§3.1); the response
 * is parsed through its contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminMetricsOpsController {
  constructor(private readonly metricsOps: AdminMetricsOpsService) {}

  @Get('metrics/ops')
  @RequirePermission('api_route', 'GET /admin/metrics/ops', 'read')
  async ops(): Promise<MetricsOps> {
    return MetricsOpsSchema.parse(await this.metricsOps.ops());
  }
}
