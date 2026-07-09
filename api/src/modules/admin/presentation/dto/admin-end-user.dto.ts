import { createZodDto } from 'nestjs-zod';
import {
  AdminEndUserLimitsQuerySchema,
  AdminEndUserSearchQuerySchema,
  AdminEndUserStatusRequestSchema,
  AdminEndUserTierRequestSchema,
  CreateManualCreditRequestSchema,
  ForceReKycRequestSchema,
  KycApproveRequestSchema,
  KycRejectRequestSchema,
  KycRequestInfoRequestSchema,
  ResendVerificationRequestSchema,
} from '@handshake-agent/contracts';

/** Query DTO for GET /admin/users (search + status/tier filter + cursor). */
export class AdminEndUserSearchQueryDto extends createZodDto(
  AdminEndUserSearchQuerySchema,
) {}

/** Query DTO for GET /admin/users/:id/limits (?currency= optional fiat code). */
export class AdminEndUserLimitsQueryDto extends createZodDto(
  AdminEndUserLimitsQuerySchema,
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

/** Request DTO for POST /admin/kyc/:userId/request-info (audited reason). */
export class KycRequestInfoDto extends createZodDto(
  KycRequestInfoRequestSchema,
) {}

/** Request DTO for POST /admin/users/:id/credit (raise a manual-credit request). */
export class CreateManualCreditDto extends createZodDto(
  CreateManualCreditRequestSchema,
) {}

/** Request DTO for POST /admin/users/:id/force-rekyc (audited reason). */
export class ForceReKycDto extends createZodDto(ForceReKycRequestSchema) {}

/**
 * Request DTO for POST /admin/users/:id/resend-verification. Reason is OPTIONAL —
 * a resend is a low-risk courtesy action (a justification is captured when the
 * operator has one but is not required).
 */
export class ResendVerificationDto extends createZodDto(
  ResendVerificationRequestSchema,
) {}
