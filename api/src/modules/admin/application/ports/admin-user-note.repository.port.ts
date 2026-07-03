// Port for the operator user-notes store (ADM Phase 9). A note is a free-text case
// annotation pinned to an end user's timeline. Notes are append-only (immutable once
// written) and queried by userId, newest-first. The application layer reaches the
// store only through this port (§3.2) — no Prisma import. Mirrors the AdminUserNote
// model (id/userId/authorAdminId/body/createdAt).

export const ADMIN_USER_NOTE_REPOSITORY = Symbol('ADMIN_USER_NOTE_REPOSITORY');

/** A persisted operator note — the user it annotates is referenced by opaque id. */
export interface AdminUserNoteRecord {
  id: string;
  userId: string;
  authorAdminId: string;
  body: string;
  createdAt: Date;
}

/** The fields a caller supplies to create a note (ids/timestamp are server-set). */
export interface CreateAdminUserNoteInput {
  userId: string;
  authorAdminId: string;
  body: string;
}

export interface IAdminUserNoteRepository {
  /** Append an immutable note and return the persisted record. */
  create(input: CreateAdminUserNoteInput): Promise<AdminUserNoteRecord>;
  /** All notes for a user, newest-first. Empty array when the user has none. */
  listForUser(userId: string): Promise<AdminUserNoteRecord[]>;
}
