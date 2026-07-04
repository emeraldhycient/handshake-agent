import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import {
  DashboardSummarySchema,
  GmvMetricsSchema,
  KycFunnelMetricsSchema,
  MoneySeriesMetricsSchema,
  RevenueMetricsSchema,
  TxnVolumeMetricsSchema,
  type DashboardSummary,
  type GmvMetrics,
  type KycFunnelMetrics,
  type MoneySeriesMetrics,
  type RevenueMetrics,
  type TxnVolumeMetrics,
} from '@handshake-agent/contracts';

import { AdminMetricsService } from '../application/admin-metrics.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { MetricsRangeQueryDto } from './dto/admin-metrics.dto';

/**
 * Phase 5 (FINAL) — READ-ONLY operational dashboard / metrics. All routes are
 * permissioned (default-deny via PermissionGuard) under the `Metrics` category.
 * Nothing here moves money (§3.1); revenue (fees + spread) is surfaced only to
 * operators on this surface, never on an end-user surface. Responses are parsed
 * through their contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminMetricsController {
  constructor(private readonly metrics: AdminMetricsService) {}

  @Get('metrics/dashboard')
  @RequirePermission('api_route', 'GET /admin/metrics/dashboard', 'read')
  async dashboard(
    @Query() query: MetricsRangeQueryDto,
  ): Promise<DashboardSummary> {
    return DashboardSummarySchema.parse(await this.metrics.dashboard(query));
  }

  @Get('metrics/transactions')
  @RequirePermission('api_route', 'GET /admin/metrics/transactions', 'read')
  async transactions(
    @Query() query: MetricsRangeQueryDto,
  ): Promise<TxnVolumeMetrics> {
    return TxnVolumeMetricsSchema.parse(await this.metrics.transactions(query));
  }

  @Get('metrics/gmv')
  @RequirePermission('api_route', 'GET /admin/metrics/gmv', 'read')
  async gmv(@Query() query: MetricsRangeQueryDto): Promise<GmvMetrics> {
    return GmvMetricsSchema.parse(await this.metrics.gmv(query));
  }

  @Get('metrics/revenue')
  @RequirePermission('api_route', 'GET /admin/metrics/revenue', 'read')
  async revenue(@Query() query: MetricsRangeQueryDto): Promise<RevenueMetrics> {
    return RevenueMetricsSchema.parse(await this.metrics.revenue(query));
  }

  @Get('metrics/money-series')
  @RequirePermission('api_route', 'GET /admin/metrics/money-series', 'read')
  async moneySeries(
    @Query() query: MetricsRangeQueryDto,
  ): Promise<MoneySeriesMetrics> {
    return MoneySeriesMetricsSchema.parse(
      await this.metrics.moneySeries(query),
    );
  }

  @Get('metrics/kyc-funnel')
  @RequirePermission('api_route', 'GET /admin/metrics/kyc-funnel', 'read')
  async kycFunnel(): Promise<KycFunnelMetrics> {
    return KycFunnelMetricsSchema.parse(await this.metrics.kycFunnel());
  }
}
