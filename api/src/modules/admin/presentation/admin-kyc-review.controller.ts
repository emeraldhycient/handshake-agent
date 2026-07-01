import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  KycQueueResponseSchema,
  KycSubmissionDetailSchema,
  type KycQueueResponse,
  type KycSubmissionDetail,
} from '@handshake-agent/contracts';

import { AdminKycReviewService } from '../application/admin-kyc-review.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { KycApproveDto, KycRejectDto } from './dto/admin-end-user.dto';

/**
 * Query DTO for GET /admin/kyc/queue — cursor-paginated. No shared contract
 * schema exists for this query (server-side pagination, not a cross-boundary
 * body shape), so it is defined inline; `limit` is coerced from its string
 * query-param form and bounded.
 */
const KycQueueQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

class KycQueueQueryDto extends createZodDto(KycQueueQuerySchema) {}

/**
 * ADM-03 KYC review queue (Phase 2, Task 5) — the compliance reviewer's surface.
 * All routes are permissioned (default-deny); the approve/reject decisions
 * additionally require a fresh step-up. The model never approves KYC — a human
 * admin does, and it is audited (§3.1). PII is minimized in the submission
 * detail (NIN/BVN last-4 only, in the service). Responses are parsed through
 * their contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminKycReviewController {
  constructor(private readonly kyc: AdminKycReviewService) {}

  @Get('kyc/queue')
  @RequirePermission('api_route', 'GET /admin/kyc/queue', 'read')
  async listQueue(@Query() query: KycQueueQueryDto): Promise<KycQueueResponse> {
    return KycQueueResponseSchema.parse(await this.kyc.listQueue(query));
  }

  @Get('kyc/:userId')
  @RequirePermission('api_route', 'GET /admin/kyc/:userId', 'read')
  async getSubmission(
    @Param('userId') userId: string,
  ): Promise<KycSubmissionDetail> {
    return KycSubmissionDetailSchema.parse(
      await this.kyc.getSubmission(userId),
    );
  }

  @Post('kyc/:userId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/kyc/:userId/approve', 'write')
  async approve(
    @Param('userId') userId: string,
    @Body() body: KycApproveDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.kyc.approve(userId, body.tier, admin.adminId);
  }

  @Post('kyc/:userId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/kyc/:userId/reject', 'write')
  async reject(
    @Param('userId') userId: string,
    @Body() body: KycRejectDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<void> {
    await this.kyc.reject(userId, body.reason, admin.adminId);
  }
}
