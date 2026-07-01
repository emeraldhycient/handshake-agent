import { z } from "zod";

import { CryptoAmountSchema, SupportedAssetSchema } from "../common";

// Admin end-user management DTOs — the platform's END USERS (not admin console
// accounts; those are AdminUser* in user.dto.ts). The enums mirror the Prisma
// identity schema (`02-identity.prisma`): UserStatus, KycStatus, KycTier,
// DeviceTrustState. Single source of truth shared by the API and web-admin.

export const AdminEndUserStatusSchema = z.enum([
  "provisional",
  "active",
  "suspended",
  "deactivated",
]);
export type AdminEndUserStatus = z.infer<typeof AdminEndUserStatusSchema>;

export const KycTierSchema = z.enum([
  "unverified",
  "tier_1",
  "tier_2",
  "tier_3",
]);
export type KycTier = z.infer<typeof KycTierSchema>;

export const KycStatusSchema = z.enum([
  "not_started",
  "pending",
  "pending_review",
  "verified",
  "rejected",
  "expired",
]);
export type KycStatus = z.infer<typeof KycStatusSchema>;

// ── Search / list ──────────────────────────────────────────────────────────────
export const AdminEndUserSearchQuerySchema = z.object({
  query: z.string().optional(),
  status: AdminEndUserStatusSchema.optional(),
  kycStatus: KycStatusSchema.optional(),
  kycTier: KycTierSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type AdminEndUserSearchQuery = z.infer<
  typeof AdminEndUserSearchQuerySchema
>;

// Per-asset aggregate of the user's cached wallet_balances rows — the list's
// balance column. Native crypto amounts only (no fiat total: a per-user FX
// conversion in a list query would be an N+1 pricing lookup, so the fiat NGN
// figure stays on the detail/wallets surface).
export const AdminEndUserBalanceSummarySchema = z.object({
  asset: z.string(),
  amount: CryptoAmountSchema,
});
export type AdminEndUserBalanceSummary = z.infer<
  typeof AdminEndUserBalanceSummarySchema
>;

export const AdminEndUserListItemSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  // KYC-captured first/last name; falls back to the email local-part, then a
  // generic label when neither is present. Never a raw PII identifier (§3.4).
  displayName: z.string(),
  status: AdminEndUserStatusSchema,
  kycStatus: KycStatusSchema,
  kycTier: KycTierSchema,
  simSwapFlagged: z.boolean(),
  // A prior sanctions/AML screening produced a `hit` verdict for this user.
  sanctionsFlagged: z.boolean(),
  // Per-asset aggregate of cached wallet balances (empty when the user has none).
  balances: z.array(AdminEndUserBalanceSummarySchema),
  // Most-recent real activity: latest of session activity, device use, or a
  // transaction — NOT the registration time. Null when the user has done nothing.
  lastActiveAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminEndUserListItem = z.infer<typeof AdminEndUserListItemSchema>;

export const AdminEndUserListResponseSchema = z.object({
  items: z.array(AdminEndUserListItemSchema),
  nextCursor: z.string().nullable(),
  // Total rows matching the filters (independent of the cursor page). Lets the
  // list header show a true count alongside the keyset pager.
  total: z.number().int().nonnegative(),
});
export type AdminEndUserListResponse = z.infer<
  typeof AdminEndUserListResponseSchema
>;

// ── Detail aggregate ─────────────────────────────────────────────────────────
export const AdminEndUserDeviceSchema = z.object({
  id: z.string().uuid(),
  trustState: z.enum(["unbound", "bound", "revoked"]),
  isPinned: z.boolean(),
  lastUsedAt: z.string().nullable(),
  boundAt: z.string().nullable(),
});
export type AdminEndUserDevice = z.infer<typeof AdminEndUserDeviceSchema>;

export const AdminEndUserBalanceSchema = z.object({
  asset: z.string(),
  network: z.string(),
  amount: CryptoAmountSchema,
  // Unconfirmed inbound deposits not yet swept into the settled balance. Null
  // when there is no pending deposit for the asset (the common case).
  pending: CryptoAmountSchema.nullable(),
});
export type AdminEndUserBalance = z.infer<typeof AdminEndUserBalanceSchema>;

// A child (per-network) on-chain deposit address provisioned for the user. All
// assets on the network share this address (Blockradar child-address model).
export const AdminEndUserDepositAddressSchema = z.object({
  network: z.string(),
  address: z.string(),
  status: z.string(),
});
export type AdminEndUserDepositAddress = z.infer<
  typeof AdminEndUserDepositAddressSchema
>;

export const AdminEndUserTxnSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  // Economics projected from Transaction.metadata — nullable because older rows
  // (and deposit/reward types) may not carry every leg. The USDT amount + NGN
  // fiat leg drive the detail Transactions tab's amount columns.
  asset: z.string().nullable(),
  amount: z.string().nullable(),
  fiatAmount: z.string().nullable(),
  fiatCurrency: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminEndUserTxn = z.infer<typeof AdminEndUserTxnSchema>;

export const AdminEndUserBeneficiarySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["bank_account", "crypto_address"]),
  label: z.string(),
  verificationStatus: z.string(),
});
export type AdminEndUserBeneficiary = z.infer<
  typeof AdminEndUserBeneficiarySchema
>;

// Recent double-entry ledger lines for the user's wallet account — a summary in
// the detail view; the full per-account ledger viewer is a later phase.
export const AdminEndUserLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string(),
  currency: z.string(),
  amount: z.string(),
  direction: z.enum(["debit", "credit"]),
  balanceAfter: z.string(),
  postedAt: z.string(),
});
export type AdminEndUserLedgerEntry = z.infer<
  typeof AdminEndUserLedgerEntrySchema
>;

export const AdminEndUserDetailSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  status: AdminEndUserStatusSchema,
  kycStatus: KycStatusSchema,
  kycTier: KycTierSchema,
  simSwapDetectedAt: z.string().nullable(),
  // Routing phone (E.164) resolved from the active WhatsApp ChannelIdentity —
  // a routing key only, never the identity anchor (§3.4). Null when the user has
  // no linked phone channel. Country/locale/marketing-consent are not modelled.
  phone: z.string().nullable(),
  createdAt: z.string(),
  devices: z.array(AdminEndUserDeviceSchema),
  balances: z.array(AdminEndUserBalanceSchema),
  // Provisioned per-network child deposit addresses (empty when none exist yet).
  depositAddresses: z.array(AdminEndUserDepositAddressSchema),
  recentTransactions: z.array(AdminEndUserTxnSchema),
  recentLedger: z.array(AdminEndUserLedgerEntrySchema),
  beneficiaries: z.array(AdminEndUserBeneficiarySchema),
});
export type AdminEndUserDetail = z.infer<typeof AdminEndUserDetailSchema>;

// ── Mutations ──────────────────────────────────────────────────────────────────
export const AdminEndUserTierRequestSchema = z.object({
  tier: KycTierSchema,
});
export type AdminEndUserTierRequest = z.infer<
  typeof AdminEndUserTierRequestSchema
>;

// Admin may set active / suspended / deactivated — never 'provisional' (a
// system-only initial state) via this endpoint.
export const AdminEndUserStatusRequestSchema = z.object({
  status: z.enum(["active", "suspended", "deactivated"]),
});
export type AdminEndUserStatusRequest = z.infer<
  typeof AdminEndUserStatusRequestSchema
>;

// ── Security: active auth sessions (GET /admin/users/:id/sessions) ────────────
// The user's JWT/refresh sessions (the `sessions` table) — read-only oversight
// for the detail Security tab. Token hashes NEVER leave the backend; only
// non-secret session metadata is projected. `current` marks nothing here (that
// concept is per-request); revocation is a Phase-7 write.
export const AdminEndUserSessionSchema = z.object({
  id: z.string().uuid(),
  // Channel the session was opened on (e.g. "web", "whatsapp").
  channel: z.string(),
  // The bound device this session belongs to, when known.
  deviceId: z.string().nullable(),
  // User-agent + binding IP surfaced from the session's device (routing/telemetry
  // only). Null when the session has no device or the device omitted them.
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  isActive: z.boolean(),
  // A fresh step-up was completed on this session (gates sensitive actions).
  stepUpCompletedAt: z.string().nullable(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  lastActivityAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type AdminEndUserSession = z.infer<typeof AdminEndUserSessionSchema>;

export const AdminEndUserSessionListResponseSchema = z.object({
  sessions: z.array(AdminEndUserSessionSchema),
});
export type AdminEndUserSessionListResponse = z.infer<
  typeof AdminEndUserSessionListResponseSchema
>;

// ── Limits: effective per-tier caps + live velocity usage (GET .../limits) ────
// Effective caps come from the layered config (§7) resolved for the user's tier
// + a fiat currency; usage comes from the live velocity counters. Read-only,
// money-adjacent but non-mutating (§3.1). Amounts are decimal strings.
export const AdminEndUserEffectiveLimitsSchema = z.object({
  // The KYC tier the caps were resolved for.
  tier: KycTierSchema,
  // Fiat the caps + usage are denominated in (e.g. "NGN").
  fiatCurrency: z.string(),
  perTxFiatMax: z.string(),
  dailyFiatMax: z.string(),
  dailyTxCountMax: z.number().int().nonnegative(),
});
export type AdminEndUserEffectiveLimits = z.infer<
  typeof AdminEndUserEffectiveLimitsSchema
>;

export const AdminEndUserVelocityUsageSchema = z.object({
  // Rolling-24h fiat total transacted, as a decimal string.
  dailyFiatUsed: z.string(),
  // Rolling-24h transaction count.
  dailyTxCount: z.number().int().nonnegative(),
  // Window the usage was measured over (ISO timestamps).
  windowStart: z.string(),
  windowEnd: z.string(),
});
export type AdminEndUserVelocityUsage = z.infer<
  typeof AdminEndUserVelocityUsageSchema
>;

export const AdminEndUserLimitsResponseSchema = z.object({
  // Null when the user is unverified (no tier caps apply until verification).
  effectiveLimits: AdminEndUserEffectiveLimitsSchema.nullable(),
  velocity: AdminEndUserVelocityUsageSchema,
});
export type AdminEndUserLimitsResponse = z.infer<
  typeof AdminEndUserLimitsResponseSchema
>;

// ── Timeline: admin-action history (GET /admin/users/:id/timeline) ────────────
// Derived from the hash-chained audit log filtered to `subject = User:<id>`.
// Read-only; each entry is one immutable audit row. Before/after snapshots are
// omitted here (they can carry sensitive detail) — only the action + actor +
// time are surfaced for the detail Profile timeline.
export const AdminEndUserTimelineEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  // "system" | "user:<id>" | "admin:<id>" | external service name.
  actor: z.string(),
  actorAdminId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type AdminEndUserTimelineEntry = z.infer<
  typeof AdminEndUserTimelineEntrySchema
>;

export const AdminEndUserTimelineResponseSchema = z.object({
  entries: z.array(AdminEndUserTimelineEntrySchema),
});
export type AdminEndUserTimelineResponse = z.infer<
  typeof AdminEndUserTimelineResponseSchema
>;

// ── Manual credit request (POST /admin/users/:id/credit) ──────────────────────
// FUNDS-SAFETY-CRITICAL (Phase 7, WRITES). An operator MAKES a request to credit
// an end user's custodial wallet (e.g. a support goodwill credit or an off-ledger
// reconciliation top-up). This endpoint is a MAKER action only: it raises a
// pending `manual_credit` ChangeRequest that a SECOND admin must approve
// (four-eyes, §3.1) — it NEVER moves money itself. On approval the engine's
// atomic `settleManualCreditAtomic` credits the user_wallet (double-entry, one
// receipt, idempotency-keyed); no raw ledger write ever originates from this UI.
//
// The body carries ONLY the parameters the engine re-validates server-side: the
// crypto `asset` (must be catalog-live), the `amount` (positive canonical decimal
// string, ≤ 8 d.p.), and the maker's `reason` (audited, shown in the inbox). The
// target user is the path :id — never trusted from the body. The server re-checks
// the user's status / KYC / sanctions before the credit is settled (§3.3).
export const CreateManualCreditRequestSchema = z.object({
  asset: SupportedAssetSchema,
  // Positive canonical decimal string — the engine rejects "0" / negatives too,
  // but the boundary refuses them here so a maker never even raises a no-op or a
  // sign-flipped credit. `refine` keeps the CryptoAmountSchema shape (≤ 8 d.p.).
  amount: CryptoAmountSchema.refine((v) => Number(v) > 0, {
    message: "Amount must be greater than zero",
  }),
  reason: z.string().min(3).max(500),
});
export type CreateManualCreditRequest = z.infer<
  typeof CreateManualCreditRequestSchema
>;
