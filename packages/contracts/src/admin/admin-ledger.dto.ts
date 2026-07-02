import { z } from "zod";

// Admin ledger oversight DTOs (Phase 3, sub-area A) — READ-ONLY projections of
// the double-entry LedgerEntry table (`06-engine.prisma`) plus a per-transaction
// integrity check. The verify endpoint NEVER mutates: it only re-sums existing
// legs and reports whether each currency nets to zero (§3.1). Decimal columns
// are canonical strings — never floats.

export const AdminLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string(),
  accountType: z.string(),
  accountId: z.string(),
  currency: z.string(),
  amount: z.string(),
  direction: z.enum(["debit", "credit"]),
  balanceAfter: z.string(),
  sequence: z.number(),
  postedAt: z.string(),
});
export type AdminLedgerEntry = z.infer<typeof AdminLedgerEntrySchema>;

export const AdminLedgerHistoryResponseSchema = z.object({
  entries: z.array(AdminLedgerEntrySchema),
});
export type AdminLedgerHistoryResponse = z.infer<
  typeof AdminLedgerHistoryResponseSchema
>;

// ── Global cross-account ledger browse (Phase 6b) ───────────────────────────
// Unlike the account-scoped history above (which requires a full
// accountType+accountId+currency triple), this browses legs across ALL accounts
// filtered only by an optional accountType and/or currency. It is newest-first
// and keyset-paginated: `cursor` is an opaque ledger-entry id and `nextCursor`
// is the id to pass next (null when the last page is reached). READ-ONLY (§3.1).

/** Query shape for GET /admin/ledger/all. Both filters optional; cursor keyset. */
export const AdminLedgerListQuerySchema = z.object({
  accountType: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type AdminLedgerListQuery = z.infer<typeof AdminLedgerListQuerySchema>;

/** Keyset page of global ledger entries (newest-first) + the next cursor. */
export const AdminLedgerListResponseSchema = z.object({
  entries: z.array(AdminLedgerEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AdminLedgerListResponse = z.infer<
  typeof AdminLedgerListResponseSchema
>;

// ── Global sequence-integrity check (Phase 6b) ──────────────────────────────
// Drives the header "Sequence integrity OK" pill. Unlike the per-transaction
// verify (which sums one txn's legs to zero), this walks every
// (accountType, accountId, currency) sub-ledger and asserts its `sequence`
// column is a gapless, correctly-ordered 1..N run. `ok` is true only when NO
// sub-ledger has a gap or reorder. `brokenAccount` is the first offending
// sub-ledger key ("accountType:accountId:currency"), else null. Read-only: it
// only reads and arithmetic-checks the append-only ledger (§3.1).
export const AdminLedgerIntegritySummarySchema = z.object({
  ok: z.boolean(),
  accountsChecked: z.number(),
  brokenAccount: z.string().nullable(),
});
export type AdminLedgerIntegritySummary = z.infer<
  typeof AdminLedgerIntegritySummarySchema
>;

// Integrity check result: per-currency the signed sum of legs (credit=+amount,
// debit=-amount) must be zero. `brokenAt` is the first currency that fails to
// net to zero (else null); `balanced` is true only when ALL currencies net to
// zero AND there is at least one leg.
export const AdminLedgerIntegrityResultSchema = z.object({
  transactionId: z.string(),
  balanced: z.boolean(),
  legCount: z.number(),
  brokenAt: z.string().nullable(),
});
export type AdminLedgerIntegrityResult = z.infer<
  typeof AdminLedgerIntegrityResultSchema
>;
