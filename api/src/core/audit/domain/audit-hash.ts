import { createHash } from 'node:crypto';

// Tamper-evident audit-chain hashing (AUD-01). Each row's `currentHash` is the
// SHA-256 of a canonical serialization of its content joined to the previous
// row's `currentHash` ('0' at genesis). Canonicalization sorts object keys
// recursively so semantically-equal payloads with different key order hash
// identically — the hash certifies content, not byte-layout. Pure: no I/O.

export interface AuditHashInput {
  actor: string;
  actorUserId: string | null;
  actorAdminId: string | null;
  subject: string;
  action: string;
  details: unknown;
  before: unknown;
  after: unknown;
  /** ISO-8601 UTC timestamp string. */
  createdAt: string;
  /** Previous row's currentHash; '0' for the genesis row. */
  prevHash: string;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(obj[key]);
      return acc;
    }, {});
}

export function computeAuditHash(input: AuditHashInput): string {
  // Fixed field order; nested values canonicalized. undefined → null.
  const payload = {
    actor: input.actor,
    actorUserId: input.actorUserId ?? null,
    actorAdminId: input.actorAdminId ?? null,
    subject: input.subject,
    action: input.action,
    details: canonicalize(input.details),
    before: canonicalize(input.before),
    after: canonicalize(input.after),
    createdAt: input.createdAt,
  };
  const serialized = `${JSON.stringify(payload)}|${input.prevHash}`;
  return createHash('sha256').update(serialized).digest('hex');
}
