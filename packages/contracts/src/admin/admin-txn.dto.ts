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
// parses to Dates for the keyset range. `q` is a free-text token matched
// server-side (case-insensitive) against id / onChainTxHash / processorTxRef /
// idempotencyKey — the design's id/hash/ref/idem search pill (Phase 6b).
export const AdminTxnSearchQuerySchema = z.object({
  status: AdminTxnStatusSchema.optional(),
  type: z.string().optional(),
  userId: z.string().uuid().optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type AdminTxnSearchQuery = z.infer<typeof AdminTxnSearchQuerySchema>;

// A list row now carries the itemized amount leg (from Transaction.metadata),
// the user's login email (for the console's derived display name — the User
// model has no name field, §3.4), and the idempotency key (the design's
// copy-on-click column). Money-carrying fields are optional strings because a
// legacy/partial row may not have populated its metadata.
export const AdminTxnListItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  /** User login email — the FE derives the display name from its local-part. */
  userEmail: z.string().nullable(),
  type: z.string(),
  status: AdminTxnStatusSchema,
  /** Crypto asset symbol for this transaction (e.g. USDT), when known. */
  asset: z.string().nullable(),
  /** Canonical decimal crypto amount string (never a float), when known. */
  amount: z.string().nullable(),
  /** Canonical decimal fiat leg string, when known. */
  fiatAmount: z.string().nullable(),
  /** Fiat currency code for `fiatAmount` (e.g. NGN), when known. */
  fiatCurrency: z.string().nullable(),
  /** Idempotency key — the at-most-once execution key (always present). */
  idempotencyKey: z.string(),
  createdAt: z.string(),
});
export type AdminTxnListItem = z.infer<typeof AdminTxnListItemSchema>;

// The four view-tab counts the design shows as count pills. Each is the exact
// number of matching rows for that view (independent of the current cursor page).
export const AdminTxnViewCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  stuck: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  refunds: z.number().int().nonnegative(),
});
export type AdminTxnViewCounts = z.infer<typeof AdminTxnViewCountsSchema>;

export const AdminTxnListResponseSchema = z.object({
  items: z.array(AdminTxnListItemSchema),
  nextCursor: z.string().nullable(),
  /** View-tab count pills (All / Stuck / Failed today / Refunds). */
  counts: AdminTxnViewCountsSchema,
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
  /** Per-(accountType, accountId) monotonic posting order — the design's Seq column. */
  sequence: z.number().int(),
  postedAt: z.string(),
});
export type AdminTxnLedgerLeg = z.infer<typeof AdminTxnLedgerLegSchema>;

// ── Itemized economics ─────────────────────────────────────────────────────────
// The confirmed parameters + operator-only margin the design's Itemized-parameters
// panel renders. Every value is a canonical decimal string (or null when the
// transaction's metadata/quote did not record it). The rate is spread-folded; the
// internal margin is operator-only and never surfaced to end users (§3.1 economics
// are projected read-only, nothing here moves money).
export const AdminTxnEconomicsSchema = z.object({
  /** Crypto asset symbol (e.g. USDT), when known. */
  asset: z.string().nullable(),
  /** Crypto amount (canonical decimal string), when known. */
  amount: z.string().nullable(),
  /** Fiat leg amount (canonical decimal string), when known. */
  fiatAmount: z.string().nullable(),
  /** Fiat currency code for `fiatAmount` (e.g. NGN), when known. */
  fiatCurrency: z.string().nullable(),
  /** Effective (spread-folded) FX rate applied, when known. */
  rate: z.string().nullable(),
  /** Processing fee charged (canonical decimal string), when known. */
  processingFee: z.string().nullable(),
  /** FX spread in basis points (as a string), when known. */
  fxSpreadBps: z.string().nullable(),
  /**
   * Operator-only internal margin (canonical decimal string) — the base-vs-
   * effective-rate delta on the fiat leg, when both rates are known. Never shown
   * to end users; the console gates it behind the operator surface.
   */
  internalMargin: z.string().nullable(),
});
export type AdminTxnEconomics = z.infer<typeof AdminTxnEconomicsSchema>;

// ── Provider references ─────────────────────────────────────────────────────────
// A labelled external reference (Flutterwave payout ref, Blockradar withdrawal id,
// TRON on-chain hash, …) projected from the transaction's columns + metadata. The
// design's Provider-references panel renders one row per entry.
export const AdminTxnProviderReferenceSchema = z.object({
  /** Provider label, e.g. 'blockradar' | 'flutterwave' | 'tron' | 'swap'. */
  provider: z.string(),
  /** The reference value (hash / ref / id). */
  reference: z.string(),
});
export type AdminTxnProviderReference = z.infer<
  typeof AdminTxnProviderReferenceSchema
>;

// A derived lifecycle event (from the transaction's non-null timestamps).
export const AdminTxnTimelineEntrySchema = z.object({
  status: z.string(),
  at: z.string(),
});
export type AdminTxnTimelineEntry = z.infer<typeof AdminTxnTimelineEntrySchema>;

export const AdminTxnDetailSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  /** User login email — the FE derives the display name from its local-part. */
  userEmail: z.string().nullable(),
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
  /** Itemized economics for the confirmed-parameters panel. */
  economics: AdminTxnEconomicsSchema,
  ledgerLegs: z.array(AdminTxnLedgerLegSchema),
  timeline: z.array(AdminTxnTimelineEntrySchema),
  /** Labelled external references (Blockradar / Flutterwave / TRON / swap). */
  providerReferences: z.array(AdminTxnProviderReferenceSchema),
});
export type AdminTxnDetail = z.infer<typeof AdminTxnDetailSchema>;
