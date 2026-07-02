import { createZodDto } from 'nestjs-zod';
import {
  AdminEndUserSearchQuerySchema,
  AdminEndUserStatusRequestSchema,
  AdminEndUserTierRequestSchema,
  CreateManualCreditRequestSchema,
  KycApproveRequestSchema,
  KycRejectRequestSchema,
} from '@handshake-agent/contracts';

/** Query DTO for GET /admin/users (search + status/tier filter + cursor). */
export class AdminEndUserSearchQueryDto extends createZodDto(
  AdminEndUserSearchQuerySchema,
) {}

/** Request DTO for PATCH /admin/users/:id/tier. */
export class AdminEndUserTierDto extends createZodDto(
  AdminEndUserTierRequestSchema,
) {}

/** Request DTO for PATCH /admin/users/:id/status. */
export class AdminEndUserStatusDto extends createZodDto(
  AdminEndUserStatusRequestSchema,
) {}

/** Request DTO for POST /admin/kyc/:userId/approve. */
export class KycApproveDto extends createZodDto(KycApproveRequestSchema) {}

/** Request DTO for POST /admin/kyc/:userId/reject. */
export class KycRejectDto extends createZodDto(KycRejectRequestSchema) {}

/** Request DTO for POST /admin/users/:id/credit (raise a manual-credit request). */
export class CreateManualCreditDto extends createZodDto(
  CreateManualCreditRequestSchema,
) {}
