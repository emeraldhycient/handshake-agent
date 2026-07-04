import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  AdminOpsRunRequestSchema,
  EscalateBreakRequestSchema,
  ReconBreakActionRequestSchema,
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

/** Body DTO for POST /admin/reconciliation/breaks/:id/escalate (3–500 char reason). */
export class EscalateBreakDto extends createZodDto(
  EscalateBreakRequestSchema,
) {}

/** Body DTO for POST /admin/treasury/payouts/:id/approve (3–500 char reason). */
export class TreasuryPayoutApproveDto extends createZodDto(
  TreasuryPayoutApproveRequestSchema,
) {}

/**
 * Body DTO for the persisted-break lifecycle actions (Go-readiness #3):
 * POST /admin/reconciliation/run-breaks/:id/{acknowledge,resolve} (non-empty reason).
 */
export class ReconBreakActionDto extends createZodDto(
  ReconBreakActionRequestSchema,
) {}

/**
 * Query DTO for GET /admin/reconciliation/runs — keyset cursor + bounded page size.
 * `limit` is coerced from the querystring and capped server-side.
 */
export const ReconRunListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export class ReconRunListQueryDto extends createZodDto(
  ReconRunListQuerySchema,
) {}
