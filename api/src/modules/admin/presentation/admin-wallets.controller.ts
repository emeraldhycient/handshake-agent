/**
 * AdminWalletsController — admin-only wallet management endpoints (WN-5).
 *
 * POST /admin/wallets/backfill-networks
 *   Triggers the idempotent backfill that provisions missing network addresses
 *   for all existing active users after a new network is enabled.
 *
 * Guard: AdminTokenGuard (Bearer <ADMIN_API_TOKEN>). Fail-closed:
 *   - ADMIN_API_TOKEN unset → every request is denied (403). The endpoint ships
 *     disabled and unexploitable by default.
 *   - Set ADMIN_API_TOKEN to enable (run the CLI first to validate the runbook).
 *
 * Admin UI hookup seam:
 *   When the admin UI + proper admin-session auth is built, swap AdminTokenGuard
 *   for the session/role guard here (and in AdminModule providers). The controller,
 *   DTO shape, and WalletBackfillService stay unchanged — only the guard is swapped.
 *
 *   Recommended path:
 *     1. Build AdminSessionGuard (JWT + admin role claim, cookie-based session, etc.).
 *     2. Replace `@UseGuards(AdminTokenGuard)` below with `@UseGuards(AdminSessionGuard)`.
 *     3. Remove ADMIN_API_TOKEN from env.schema once all callers are migrated.
 *
 * Architecture: presentation layer only. No Prisma, no domain logic, no agent.
 * Delegates entirely to WalletBackfillService (application layer).
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { BackfillReport } from '@handshake-agent/contracts';

import { AdminTokenGuard } from '../guards/admin-token.guard';
import { WalletBackfillService } from '../../wallets/application/wallet-backfill.service';
import { BackfillNetworksDto } from './dto/backfill-networks.dto';

@Controller('admin/wallets')
@UseGuards(AdminTokenGuard)
export class AdminWalletsController {
  constructor(private readonly walletBackfillService: WalletBackfillService) {}

  /**
   * POST /admin/wallets/backfill-networks
   *
   * Provisions missing network wallet addresses for all existing active users.
   * Idempotent — safe to call multiple times. Users who already have wallets
   * on all enabled networks are counted in `alreadyHad` and skipped.
   *
   * Use `dryRun: true` to audit scope without creating any wallets.
   *
   * @returns BackfillReport with per-network tallies and per-user failures.
   */
  @Post('backfill-networks')
  @HttpCode(HttpStatus.OK)
  async backfillNetworks(
    @Body() dto: BackfillNetworksDto,
  ): Promise<BackfillReport> {
    return this.walletBackfillService.backfillMissingNetworkAddresses({
      batchSize: dto.batchSize,
      dryRun: dto.dryRun,
    });
  }
}
