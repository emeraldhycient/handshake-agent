import { createZodDto } from 'nestjs-zod';
import {
  AdminEndUsersExportQuerySchema,
  AdminLedgerExportQuerySchema,
  AuditLogExportQuerySchema,
} from '@handshake-agent/contracts';

/**
 * CSV-export QUERY DTOs (Phase 8). Each mirrors the corresponding LIST query with
 * the paging fields (`cursor`/`limit`) stripped — an export covers ALL rows
 * matching the current filters, not just the visible page. Every export also
 * carries an optional audited `reason` (the endpoint records an `admin_export`
 * audit event with the resulting rowCount). Shapes come from `@handshake-agent/
 * contracts` (§8); exports are PII-minimised (last-4 only) server-side (§3.4).
 */

/** Query DTO for GET /admin/users/export. */
export class AdminEndUsersExportQueryDto extends createZodDto(
  AdminEndUsersExportQuerySchema,
) {}

/** Query DTO for GET /admin/ledger/export. */
export class AdminLedgerExportQueryDto extends createZodDto(
  AdminLedgerExportQuerySchema,
) {}

/** Query DTO for GET /admin/audit/export. */
export class AuditLogExportQueryDto extends createZodDto(
  AuditLogExportQuerySchema,
) {}
