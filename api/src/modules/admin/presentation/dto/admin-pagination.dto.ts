import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Generic keyset-pagination query for the read-only admin list endpoints
 * (Phase 4 wave 2: tickets orders + agent conversations). An internal read query,
 * not a cross-boundary request body, so it is kept local to presentation. `limit`
 * is coerced from the query string and capped; `cursor` is an opaque row id.
 */
export const AdminPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export class AdminPaginationQueryDto extends createZodDto(
  AdminPaginationQuerySchema,
) {}
