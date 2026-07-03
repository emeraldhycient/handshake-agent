import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminUserNote,
  AdminUserNoteListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  ADMIN_USER_NOTE_REPOSITORY,
  type AdminUserNoteRecord,
  type IAdminUserNoteRepository,
} from './ports/admin-user-note.repository.port';

/**
 * ADM Phase 9 — operator user-notes: free-text case annotations pinned to an end
 * user's timeline. A note is append-only (immutable once written). The target user
 * is always the path :id threaded straight through — never trusted from the body —
 * and the author is the authenticated admin. It moves no money (§3.1) and holds no
 * Prisma import — it reaches the store only through the injected port (§3.2).
 *
 * The wire shape (`AdminUserNote`) exposes id/body/authorAdminId/createdAt only; the
 * owning userId never crosses the boundary (§3.4 — a note references its subject by
 * the path id the caller already holds). Every create is immutably audited as
 * `admin_update` against the `User:<id>` subject; a list is a read and is not audited.
 */
@Injectable()
export class AdminUserNoteService {
  constructor(
    @Inject(ADMIN_USER_NOTE_REPOSITORY)
    private readonly repo: IAdminUserNoteRepository,
    private readonly audit: AuditService,
  ) {}

  /** Append an immutable note to the user's timeline; audits the write. */
  async create(
    userId: string,
    body: string,
    adminId: string,
  ): Promise<AdminUserNote> {
    const record = await this.repo.create({
      userId,
      authorAdminId: adminId,
      body,
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `User:${userId}`,
      action: 'admin_update',
      after: { noteId: record.id },
    });

    return toWire(record);
  }

  /** All notes for a user, newest-first, projected to the wire shape. A read. */
  async list(userId: string): Promise<AdminUserNoteListResponse> {
    const records = await this.repo.listForUser(userId);
    return { items: records.map(toWire) };
  }
}

/**
 * Project a stored note to the wire `AdminUserNote` shape. Drops the owning userId
 * (the caller already holds it as the path id) and renders createdAt as ISO.
 */
function toWire(record: AdminUserNoteRecord): AdminUserNote {
  return {
    id: record.id,
    body: record.body,
    authorAdminId: record.authorAdminId,
    createdAt: record.createdAt.toISOString(),
  };
}
