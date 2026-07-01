import { z } from "zod";

// Admin transactions oversight DTOs (Phase 3, sub-area A) — READ-ONLY surfaces
// for the deterministic-engine's Transaction + double-entry ledger. The enums
// mirror the Prisma engine schema (`06-engine.prisma`): TransactionStatus and
// LedgerDirection. Single source of truth shared by the API and web-admin.
// Nothing here moves money (§3.1) — these shapes only project existing rows.

export const AdminTxnStatusSchema = z.enum([
  "pending",
  "validating",
  "confirmed",
  "settling",
  "completed",
  "failed",
  "rolled_back",
  "cancelled",
]);
export type AdminTxnStatus = z.infer<typeof AdminTxnStatusSchema>;

// ── Search / list ──────────────────────────────────────────────────────────────
// `type` is a free string (TransactionType grows additively; the repository
// validates it against the live enum). `from`/`to` are ISO strings the service
// parses to Dates for the keyset range.
export const AdminTxnSearchQuerySchema = z.object({
  status: AdminTxnStatusSchema.optional(),
  type: z.string().optional(),
  userId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type AdminTxnSearchQuery = z.infer<typeof AdminTxnSearchQuerySchema>;

export const AdminTxnListItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(),
  status: AdminTxnStatusSchema,
  createdAt: z.string(),
});
export type AdminTxnListItem = z.infer<typeof AdminTxnListItemSchema>;

export const AdminTxnListResponseSchema = z.object({
  items: z.array(AdminTxnListItemSchema),
  nextCursor: z.string().nullable(),
});
export type AdminTxnListResponse = z.infer<typeof AdminTxnListResponseSchema>;

// ── Detail aggregate ─────────────────────────────────────────────────────────
// A single double-entry leg posted by this transaction (decimal columns are
// canonical strings — never floats).
export const AdminTxnLedgerLegSchema = z.object({
  accountType: z.string(),
  accountId: z.string(),
  currency: z.string(),
  amount: z.string(),
  direction: z.enum(["debit", "credit"]),
  balanceAfter: z.string(),
  postedAt: z.string(),
});
export type AdminTxnLedgerLeg = z.infer<typeof AdminTxnLedgerLegSchema>;

// A derived lifecycle event (from the transaction's non-null timestamps).
export const AdminTxnTimelineEntrySchema = z.object({
  status: z.string(),
  at: z.string(),
});
export type AdminTxnTimelineEntry = z.infer<typeof AdminTxnTimelineEntrySchema>;

export const AdminTxnDetailSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(),
  status: AdminTxnStatusSchema,
  idempotencyKey: z.string(),
  processorTxRef: z.string().nullable(),
  onChainTxHash: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  executedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  ledgerLegs: z.array(AdminTxnLedgerLegSchema),
  timeline: z.array(AdminTxnTimelineEntrySchema),
});
export type AdminTxnDetail = z.infer<typeof AdminTxnDetailSchema>;
