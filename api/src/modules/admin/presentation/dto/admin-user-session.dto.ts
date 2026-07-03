import { createZodDto } from 'nestjs-zod';

import { AdminUserSessionRevokeRequestSchema } from '@handshake-agent/contracts';

/**
 * Body DTO for the session-revoke routes (single + all). Carries the operator's
 * audited `reason` for the force sign-out — validated server-side (§3.3) before
 * the mutation runs.
 */
export class AdminUserSessionRevokeDto extends createZodDto(
  AdminUserSessionRevokeRequestSchema,
) {}
