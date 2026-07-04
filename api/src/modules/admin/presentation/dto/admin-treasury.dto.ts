import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  TreasuryAlertAcknowledgeRequestSchema,
  TreasuryPayoutRetryRequestSchema,
} from '@handshake-agent/contracts';

/**
 * Query DTO for GET /admin/treasury/alerts. `acknowledged` filters the feed:
 *   true  → only acknowledged alerts
 *   false → only unacknowledged alerts
 *   omit  → all alerts
 * Booleans arrive as query strings, so coerce 'true'/'false' explicitly.
 */
export const TreasuryAlertQuerySchema = z.object({
  acknowledged: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export class TreasuryAlertQueryDto extends createZodDto(
  TreasuryAlertQuerySchema,
) {}

/** Body DTO for POST /admin/treasury/alerts/:id/acknowledge (optional note). */
export class TreasuryAlertAcknowledgeDto extends createZodDto(
  TreasuryAlertAcknowledgeRequestSchema,
) {}

/** Body DTO for POST /admin/treasury/payouts/:id/retry (operator reason, required). */
export class TreasuryPayoutRetryDto extends createZodDto(
  TreasuryPayoutRetryRequestSchema,
) {}
