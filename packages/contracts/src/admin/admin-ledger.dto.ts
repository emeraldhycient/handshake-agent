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
