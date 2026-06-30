import { z } from "zod";

// Admin TREASURY OVERSIGHT DTOs (Phase 3, sub-area D) — aggregated custodial
// balances, real-time exposure-vs-limit snapshots, threshold-breach alerts (with
// acknowledgement), and per-wallet withdrawal-policy visibility. The enums mirror
// the Prisma pricing/wallet schema (`05-pricing.prisma`, `04-wallets.prisma`):
// ExposureStatus, AlertSeverity. Single source of truth shared by the API
// (response parsing) and web-admin. Nothing here moves money (§3.1) — these
// shapes only project / annotate existing treasury + wallet rows. Crypto amounts
// are byte-stable strings; fiat amounts are Decimal serialized to strings.

// ── Aggregated balances — SUM(WalletBalance.amount) grouped by network + asset ─────
export const TreasuryBalanceSchema = z.object({
  network: z.string(),
  asset: z.string(),
  totalAmount: z.string(),
  walletCount: z.number(),
});
export type TreasuryBalance = z.infer<typeof TreasuryBalanceSchema>;

export const TreasuryBalancesResponseSchema = z.object({
  balances: z.array(TreasuryBalanceSchema),
});
export type TreasuryBalancesResponse = z.infer<
  typeof TreasuryBalancesResponseSchema
>;

// ── Exposure — real-time inventory position vs configured limit (read-only) ─────────
export const TreasuryExposureStatusSchema = z.enum([
  "safe",
  "warning",
  "critical",
]);
export type TreasuryExposureStatus = z.infer<
  typeof TreasuryExposureStatusSchema
>;

export const TreasuryExposureSchema = z.object({
  id: z.string().uuid(),
  asset: z.string(),
  fiatCurrency: z.string(),
  cryptoHeld: z.string(),
  fiatEquivalent: z.string(),
  netExposure: z.string(),
  exposureLimitBps: z.number(),
  status: TreasuryExposureStatusSchema,
  createdAt: z.string(),
});
export type TreasuryExposure = z.infer<typeof TreasuryExposureSchema>;

export const TreasuryExposureListResponseSchema = z.object({
  items: z.array(TreasuryExposureSchema),
});
export type TreasuryExposureListResponse = z.infer<
  typeof TreasuryExposureListResponseSchema
>;

// ── Alerts — immutable exposure-threshold breaches, acknowledgeable by an admin ─────
export const TreasuryAlertSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);
export type TreasuryAlertSeverity = z.infer<typeof TreasuryAlertSeveritySchema>;

export const TreasuryAlertSchema = z.object({
  id: z.string().uuid(),
  asset: z.string(),
  severity: TreasuryAlertSeveritySchema,
  message: z.string(),
  netExposure: z.string(),
  triggeredAt: z.string(),
  acknowledgedAt: z.string().nullable(),
});
export type TreasuryAlert = z.infer<typeof TreasuryAlertSchema>;

export const TreasuryAlertListResponseSchema = z.object({
  items: z.array(TreasuryAlertSchema),
});
export type TreasuryAlertListResponse = z.infer<
  typeof TreasuryAlertListResponseSchema
>;

// `note` is the audited acknowledgement annotation (optional).
export const TreasuryAlertAcknowledgeRequestSchema = z.object({
  note: z.string().optional(),
});
export type TreasuryAlertAcknowledgeRequest = z.infer<
  typeof TreasuryAlertAcknowledgeRequestSchema
>;

// ── Withdrawal policies — active per-wallet controls (read-only) ────────────────────
export const WithdrawalPolicySchema = z.object({
  id: z.string().uuid(),
  walletId: z.string().uuid(),
  maxWithdrawalPerTx: z.string().nullable(),
  maxWithdrawalPerDay: z.string().nullable(),
  requiresApproval: z.boolean(),
  allowListMode: z.string(),
  enabledAt: z.string(),
});
export type WithdrawalPolicy = z.infer<typeof WithdrawalPolicySchema>;

export const WithdrawalPolicyListResponseSchema = z.object({
  items: z.array(WithdrawalPolicySchema),
});
export type WithdrawalPolicyListResponse = z.infer<
  typeof WithdrawalPolicyListResponseSchema
>;
