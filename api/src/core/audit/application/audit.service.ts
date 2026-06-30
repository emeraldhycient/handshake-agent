import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditAction,
  type IAuditLogRepository,
} from './ports/audit-log.repository.port';

// High-level input for callers: the `actor` string is derived from the
// principal ids, so command services just pass who did it (admin/user) plus the
// before/after snapshots. The hash chain itself lives in the repository.
export interface RecordAuditInput {
  correlationId: string;
  actorAdminId?: string | null;
  actorUserId?: string | null;
  /** Override the derived actor string (e.g. an external service name). */
  actor?: string;
  subject: string;
  action: AuditAction;
  details?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly repo: IAuditLogRepository,
  ) {}

  async record(input: RecordAuditInput): Promise<void> {
    const actor =
      input.actor ??
      (input.actorAdminId
        ? `admin:${input.actorAdminId}`
        : input.actorUserId
          ? `user:${input.actorUserId}`
          : 'system');

    await this.repo.append({
      correlationId: input.correlationId,
      actor,
      actorAdminId: input.actorAdminId ?? null,
      actorUserId: input.actorUserId ?? null,
      subject: input.subject,
      action: input.action,
      details: input.details ?? {},
      before: input.before ?? null,
      after: input.after ?? null,
    });
  }
}
