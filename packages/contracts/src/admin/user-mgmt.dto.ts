import { z } from "zod";

import { CryptoAmountSchema } from "../common";

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
  kycTier: KycTierSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type AdminEndUserSearchQuery = z.infer<
  typeof AdminEndUserSearchQuerySchema
>;

export const AdminEndUserListItemSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  status: AdminEndUserStatusSchema,
  kycStatus: KycStatusSchema,
  kycTier: KycTierSchema,
  simSwapFlagged: z.boolean(),
  createdAt: z.string(),
});
export type AdminEndUserListItem = z.infer<typeof AdminEndUserListItemSchema>;

export const AdminEndUserListResponseSchema = z.object({
  items: z.array(AdminEndUserListItemSchema),
  nextCursor: z.string().nullable(),
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
});
export type AdminEndUserBalance = z.infer<typeof AdminEndUserBalanceSchema>;

export const AdminEndUserTxnSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
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
  createdAt: z.string(),
  devices: z.array(AdminEndUserDeviceSchema),
  balances: z.array(AdminEndUserBalanceSchema),
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
