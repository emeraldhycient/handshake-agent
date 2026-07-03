import { z } from "zod";

// Admin PHASE 9 DTOs (the operator console's deferred WRITES) — the shared
// source of truth for the API (request + response parsing) and web-admin (§8).
// Every mutation these describe is reason→step-up + immutably audited server-side
// (root CLAUDE.md §3.4); none moves money (§3.1). No full PII crosses this
// boundary — a user/beneficiary/note references its subject by opaque id only.

// A reason is the operator's audited justification for a sensitive mutation.
// min 3 (never a blank audit line) / max 500 (a one-line rationale, not a doc).
const auditedReason = z.string().min(3).max(500);

// ── Beneficiary removal (admin-initiated) ────────────────────────────────────
export const AdminBeneficiaryRemoveRequestSchema = z.object({
  reason: auditedReason,
});
export type AdminBeneficiaryRemoveRequest = z.infer<
  typeof AdminBeneficiaryRemoveRequestSchema
>;

// ── Session revocation (force sign-out of a user's bound devices/sessions) ────
export const AdminUserSessionRevokeRequestSchema = z.object({
  reason: auditedReason,
});
export type AdminUserSessionRevokeRequest = z.infer<
  typeof AdminUserSessionRevokeRequestSchema
>;

// ── Force re-KYC (e.g. after a SIM-swap / identity concern) ───────────────────
export const ForceReKycRequestSchema = z.object({
  reason: auditedReason,
});
export type ForceReKycRequest = z.infer<typeof ForceReKycRequestSchema>;

// ── KYC "needs more info" (bounce the review back to the user) ────────────────
export const KycRequestInfoRequestSchema = z.object({
  reason: auditedReason,
});
export type KycRequestInfoRequest = z.infer<typeof KycRequestInfoRequestSchema>;

// ── Resend verification (re-send a verification email/link) ───────────────────
// Reason is optional here — a resend is low-risk and often a courtesy action; a
// justification is captured when the operator has one but is not required.
export const ResendVerificationRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type ResendVerificationRequest = z.infer<
  typeof ResendVerificationRequestSchema
>;

// ── Admin user notes (free-text case notes on a user) ─────────────────────────
// A note is not a justification line — it is a longer case annotation, so it
// carries its own bounds (min 1 / max 2000). Notes are immutable once written.
export const AdminUserNoteCreateRequestSchema = z.object({
  body: z.string().min(1).max(2000),
});
export type AdminUserNoteCreateRequest = z.infer<
  typeof AdminUserNoteCreateRequestSchema
>;

export const AdminUserNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  authorAdminId: z.string(),
  createdAt: z.string().datetime(),
});
export type AdminUserNote = z.infer<typeof AdminUserNoteSchema>;

export const AdminUserNoteListResponseSchema = z.object({
  items: z.array(AdminUserNoteSchema),
});
export type AdminUserNoteListResponse = z.infer<
  typeof AdminUserNoteListResponseSchema
>;

// ── Blocked entries (deny-list a user / address / bank) ───────────────────────
// A blocked entry gates a subject out of the money path. It is append-only:
// lifting a block SUPERSEDES the row (records who/when) rather than deleting it,
// so the deny-list history stays fully auditable (§3.4). Mirrors the BlockedEntry
// model (kind enum + supersededAt/By columns).
export const BlockedEntryKindSchema = z.enum(["user", "address", "bank"]);
export type BlockedEntryKind = z.infer<typeof BlockedEntryKindSchema>;

export const BlockedEntrySchema = z.object({
  id: z.string(),
  kind: BlockedEntryKindSchema,
  value: z.string(),
  reason: z.string(),
  addedByAdminId: z.string(),
  createdAt: z.string().datetime(),
  supersededAt: z.string().datetime().nullable(),
});
export type BlockedEntry = z.infer<typeof BlockedEntrySchema>;

export const BlockedEntryListResponseSchema = z.object({
  items: z.array(BlockedEntrySchema),
});
export type BlockedEntryListResponse = z.infer<
  typeof BlockedEntryListResponseSchema
>;

export const BlockedEntryCreateRequestSchema = z.object({
  kind: BlockedEntryKindSchema,
  value: z.string().min(1),
  reason: auditedReason,
});
export type BlockedEntryCreateRequest = z.infer<
  typeof BlockedEntryCreateRequestSchema
>;

// ── Supersede (lift) a blocked entry ──────────────────────────────────────────
export const BlockedEntrySupersedeRequestSchema = z.object({
  reason: auditedReason,
});
export type BlockedEntrySupersedeRequest = z.infer<
  typeof BlockedEntrySupersedeRequestSchema
>;
