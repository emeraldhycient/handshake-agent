/**
 * Opaque keyset cursor for transaction-history pagination.
 *
 * Encodes the last-seen position `(createdAt, id)` as a base64url string so the
 * client can treat it as opaque. Pure — no I/O, no Date.now(). The repository
 * pages on `(createdAt desc, id desc)`; `id` (uuid7) is the unique tie-break so
 * rows sharing a `createdAt` are never duplicated or skipped across pages.
 */

const SEP = '|';

export interface CursorPosition {
  createdAt: Date;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}${SEP}${id}`, 'utf8').toString(
    'base64url',
  );
}

/** Decodes a cursor; returns null for any malformed / tampered / invalid value. */
export function decodeCursor(raw: string): CursorPosition | null {
  if (!raw) return null;

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.indexOf(SEP);
  if (sep <= 0) return null;

  const iso = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!id) return null;

  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;

  return { createdAt, id };
}
