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

// ── Child-address sweeps (Phase 6b) — per-child receive address + gas-sweep state ───
// Each row is a per-user child deposit address (real, from Wallet.address). The
// on-chain gas (TRX) balance and last-sweep lifecycle are the operational sweep view:
//   swept           → balance was gathered to the master wallet
//   pending         → over the sweep threshold, awaiting the next sweep cycle
//   below_threshold → under the configured threshold, not worth a sweep yet
// `balance` is a byte-stable string; `lastSweptAt` is ISO or null (never swept).
export const TreasurySweepStatusSchema = z.enum([
  "swept",
  "pending",
  "below_threshold",
]);
export type TreasurySweepStatus = z.infer<typeof TreasurySweepStatusSchema>;

export const TreasurySweepSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  network: z.string(),
  asset: z.string(),
  balance: z.string(),
  status: TreasurySweepStatusSchema,
  lastSweptAt: z.string().nullable(),
});
export type TreasurySweep = z.infer<typeof TreasurySweepSchema>;

// The list carries the configured sweep threshold (e.g. "25" TRX) so the footer can
// render it without a separate config read.
export const TreasurySweepListResponseSchema = z.object({
  items: z.array(TreasurySweepSchema),
  sweepThreshold: z.string(),
  thresholdAsset: z.string(),
});
export type TreasurySweepListResponse = z.infer<
  typeof TreasurySweepListResponseSchema
>;

// ── Payout / withdrawal approval queue (Phase 6b, READ-ONLY) ────────────────────────
// Pending outbound settlements (processor payouts + on-chain sends) awaiting release.
// This is a READ projection only — approving/releasing is an engine-brokered WRITE
// deferred to Phase 7 (§3.1). `requiresApproval` flags a large payout that must clear
// maker-checker. `fiatAmount` is the NGN leg when the asset is crypto, else null.
export const TreasuryPayoutQueueItemSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid(),
  beneficiaryLabel: z.string(),
  reference: z.string(),
  method: z.string(),
  asset: z.string(),
  amount: z.string(),
  fiatAmount: z.string().nullable(),
  requiresApproval: z.boolean(),
  submittedAt: z.string(),
});
export type TreasuryPayoutQueueItem = z.infer<
  typeof TreasuryPayoutQueueItemSchema
>;

export const TreasuryPayoutQueueResponseSchema = z.object({
  items: z.array(TreasuryPayoutQueueItemSchema),
});
export type TreasuryPayoutQueueResponse = z.infer<
  typeof TreasuryPayoutQueueResponseSchema
>;

// ── NGN fiat float (Phase 6b) — platform_float ledger balance vs a configured target ─
// `balance` is the running balance of the platform_float ledger account for the
// currency; `targetFloat` is the desired operating float (config); `utilizationBps` =
// balance/target in basis points. `status` is derived: below the low-float threshold →
// "low", otherwise "healthy". `lowFloatThresholdBps` is the configured floor.
export const TreasuryFiatFloatStatusSchema = z.enum(["healthy", "low"]);
export type TreasuryFiatFloatStatus = z.infer<
  typeof TreasuryFiatFloatStatusSchema
>;

export const TreasuryFiatFloatSchema = z.object({
  currency: z.string(),
  balance: z.string(),
  targetFloat: z.string(),
  utilizationBps: z.number(),
  status: TreasuryFiatFloatStatusSchema,
  lowFloatThresholdBps: z.number(),
});
export type TreasuryFiatFloat = z.infer<typeof TreasuryFiatFloatSchema>;

export const TreasuryFiatFloatResponseSchema = z.object({
  items: z.array(TreasuryFiatFloatSchema),
});
export type TreasuryFiatFloatResponse = z.infer<
  typeof TreasuryFiatFloatResponseSchema
>;

// ── FX position / exposure headroom (Phase 6b) ──────────────────────────────────────
// The signed net inventory position per (asset, fiat), valued in the fiat currency,
// plus the derived exposure headroom the exposure card lacked (a single scalar the
// design's "72%" tile needs). `direction` is long/short/flat off the sign of the net
// position; `headroomBps` = (limit − netExposure)/limit in basis points, clamped ≥ 0;
// `exposureStatus` mirrors the underlying TreasuryExposure status.
export const TreasuryFxDirectionSchema = z.enum(["long", "short", "flat"]);
export type TreasuryFxDirection = z.infer<typeof TreasuryFxDirectionSchema>;

export const TreasuryFxPositionSchema = z.object({
  asset: z.string(),
  fiatCurrency: z.string(),
  netPositionFiat: z.string(),
  direction: TreasuryFxDirectionSchema,
  headroomBps: z.number(),
  exposureStatus: TreasuryExposureStatusSchema,
});
export type TreasuryFxPosition = z.infer<typeof TreasuryFxPositionSchema>;

export const TreasuryFxPositionResponseSchema = z.object({
  items: z.array(TreasuryFxPositionSchema),
});
export type TreasuryFxPositionResponse = z.infer<
  typeof TreasuryFxPositionResponseSchema
>;
