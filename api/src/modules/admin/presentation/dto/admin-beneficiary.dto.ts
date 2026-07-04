import { createZodDto } from 'nestjs-zod';

import { AdminBeneficiaryRemoveRequestSchema } from '@handshake-agent/contracts';

/**
 * Body DTO for DELETE /admin/beneficiaries/:id (Phase 9 — admin-initiated
 * soft-delete). Carries the operator's audited justification (3–500 chars).
 */
export class AdminBeneficiaryRemoveDto extends createZodDto(
  AdminBeneficiaryRemoveRequestSchema,
) {}
