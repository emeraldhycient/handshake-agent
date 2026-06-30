import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AdminTxnSearchQuerySchema } from '@handshake-agent/contracts';

/** Query DTO for GET /admin/transactions (status/type/userId/window + cursor). */
export class AdminTxnSearchQueryDto extends createZodDto(
  AdminTxnSearchQuerySchema,
) {}

/**
 * Query DTO for GET /admin/ledger. The triple (accountType, accountId, currency)
 * scopes the history; `limit` is optional (coerced, capped). This is an internal
 * read query, not a cross-boundary request body — kept local to presentation.
 */
export const AdminLedgerHistoryQuerySchema = z.object({
  accountType: z.string().min(1),
  accountId: z.string().min(1),
  currency: z.string().min(1),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export class AdminLedgerHistoryQueryDto extends createZodDto(
  AdminLedgerHistoryQuerySchema,
) {}
