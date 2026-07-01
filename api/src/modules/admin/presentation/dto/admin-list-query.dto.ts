import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuditLogQuerySchema } from '@handshake-agent/contracts';

/**
 * Query DTO for GET /admin/admins — cursor-paginated list. No shared contract
 * schema exists for this query (it is a server-side pagination concern, not a
 * cross-boundary body shape), so it is defined inline; `limit` is coerced from
 * its string query-param form and bounded to the repository's max.
 */
const AdminUserListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export class AdminUserListQueryDto extends createZodDto(
  AdminUserListQuerySchema,
) {}

/** Query DTO for GET /admin/audit — filters + cursor + bounded limit. */
export class AuditLogQueryDto extends createZodDto(AuditLogQuerySchema) {}
