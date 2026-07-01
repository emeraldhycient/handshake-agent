import { createZodDto } from 'nestjs-zod';

import {
  AdminOpsRunRequestSchema,
  ReconResolveRequestSchema,
  ReconAcceptRequestSchema,
  TreasuryPayoutApproveRequestSchema,
} from '@handshake-agent/contracts';

/** Body DTO for POST /admin/ops/jobs/:id/run (non-empty reason). */
export class AdminOpsRunDto extends createZodDto(AdminOpsRunRequestSchema) {}

/** Body DTO for POST /admin/reconciliation/breaks/:id/resolve (non-empty reason). */
export class ReconResolveDto extends createZodDto(ReconResolveRequestSchema) {}

/** Body DTO for POST /admin/reconciliation/breaks/:id/accept (non-empty reason). */
export class ReconAcceptDto extends createZodDto(ReconAcceptRequestSchema) {}

/** Body DTO for POST /admin/treasury/payouts/:id/approve (3–500 char reason). */
export class TreasuryPayoutApproveDto extends createZodDto(
  TreasuryPayoutApproveRequestSchema,
) {}
