import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ProviderRegistryViewSchema,
  ProviderTestResponseSchema,
  type ProviderRegistryView,
  type ProviderTestResponse,
} from '@handshake-agent/contracts';

import { AdminProvidersService } from '../application/admin-providers.service';
import { AdminProviderProbeService } from '../application/admin-provider-probe.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * Admin Providers surface (Phase 6b READ + Phase 7 "Test connection" WRITE-adjacent).
 * The read returns per-provider non-secret wiring, mock-mode, bound capabilities, a
 * posture-derived status, and secret-PRESENCE booleans only — the secret VALUES never
 * cross this boundary (§3.4 / §3.5). The "Test connection" probe runs a real,
 * credential-free liveness check (reachability + latency) — it exposes NO secret and
 * moves NO money (§3.1); it is execute-gated + step-up-gated. Responses are parsed
 * through their contract schema before the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminProvidersController {
  constructor(
    private readonly providers: AdminProvidersService,
    private readonly probe: AdminProviderProbeService,
  ) {}

  @Get('providers')
  @RequirePermission('api_route', 'GET /admin/providers', 'read')
  getRegistry(): ProviderRegistryView {
    return ProviderRegistryViewSchema.parse(this.providers.getRegistry());
  }

  // ── "Test connection" (Phase 7, WRITE-adjacent — liveness probe; step-up-gated) ──

  @Post('providers/:key/test')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/providers/:key/test', 'execute')
  async test(@Param('key') key: string): Promise<ProviderTestResponse> {
    return ProviderTestResponseSchema.parse(await this.probe.test(key));
  }
}
