import { randomUUID } from 'node:crypto';

import type { Response } from 'express';

import { buildCsv, type CsvCell } from '../application/csv';
import { AuditService } from '../../../core/audit/application/audit.service';

/** One export domain — used for the audit subject and the download filename. */
export type CsvExportSubject = 'users' | 'ledger' | 'audit';

/**
 * Build a CSV from the header + rows, stream it as `text/csv` with an attachment
 * disposition, and record an `admin_export` audit event with the resulting
 * rowCount + the applied filters (§ every export is audited). The immutable,
 * hash-chained log records who exported what, when — never the exported data
 * itself (and the rows already carry last-4 PII only, §3.4).
 *
 * Written on the SUCCESS path only: any error thrown while building the rows
 * bubbles to the global filter and is returned as JSON, never a truncated CSV.
 */
export async function sendCsvExport(params: {
  res: Response;
  audit: AuditService;
  actorAdminId: string;
  subject: CsvExportSubject;
  header: readonly CsvCell[];
  rows: readonly (readonly CsvCell[])[];
  /** The applied, non-secret filters — recorded in the audit `after` payload. */
  filters: Record<string, unknown>;
}): Promise<void> {
  const { res, audit, actorAdminId, subject, header, rows, filters } = params;

  const csv = buildCsv(header, rows);
  const filename = `${subject}-export-${new Date().toISOString().slice(0, 10)}.csv`;

  await audit.record({
    correlationId: randomUUID(),
    actorAdminId,
    subject: `Export:${subject}`,
    action: 'admin_export',
    after: { rowCount: rows.length, filters },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
