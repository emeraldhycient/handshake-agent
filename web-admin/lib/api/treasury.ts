/**
 * Typed admin treasury-oversight API clients (Phase 3, sub-area D) — aggregated
 * custodial balances, exposure-vs-limit snapshots, threshold-breach alerts (with
 * acknowledgement), and per-wallet withdrawal-policy visibility. Each parses its
 * input through the request schema before the request fires and parses the
 * response through the response schema after (§3.3 / §8: the FE gate is UX, never
 * the only check; shapes that cross the boundary come from contracts).
 *
 * Acknowledge is sensitive and may 403 with ADMIN_STEP_UP_REQUIRED; the caller
 * wraps it in `useStepUpRetry`. Nothing here moves money (§3.1).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  TreasuryBalancesResponseSchema,
  TreasuryExposureListResponseSchema,
  TreasuryAlertListResponseSchema,
  TreasuryAlertSchema,
  TreasuryAlertAcknowledgeRequestSchema,
  WithdrawalPolicyListResponseSchema,
  TreasurySweepListResponseSchema,
  TreasuryPayoutQueueResponseSchema,
  TreasuryFiatFloatResponseSchema,
  TreasuryFxPositionResponseSchema,
  type TreasuryBalancesResponse,
  type TreasuryExposureListResponse,
  type TreasuryAlertListResponse,
  type TreasuryAlert,
  type TreasuryAlertAcknowledgeRequest,
  type WithdrawalPolicyListResponse,
  type TreasurySweepListResponse,
  type TreasuryPayoutQueueResponse,
  type TreasuryFiatFloatResponse,
  type TreasuryFxPositionResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/treasury/balances — aggregated custodial balances by network + asset. */
export async function listTreasuryBalances(): Promise<TreasuryBalancesResponse> {
  const res = await api.get("/admin/treasury/balances")
  return TreasuryBalancesResponseSchema.parse(res.data)
}

/** GET /admin/treasury/exposure — real-time inventory position vs configured limit. */
export async function listTreasuryExposure(): Promise<TreasuryExposureListResponse> {
  const res = await api.get("/admin/treasury/exposure")
  return TreasuryExposureListResponseSchema.parse(res.data)
}

/** GET /admin/treasury/alerts — exposure-threshold breaches. */
export async function listTreasuryAlerts(): Promise<TreasuryAlertListResponse> {
  const res = await api.get("/admin/treasury/alerts")
  return TreasuryAlertListResponseSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the acked alert. */
export async function acknowledgeTreasuryAlert(
  id: string,
  input: TreasuryAlertAcknowledgeRequest
): Promise<TreasuryAlert> {
  const body = TreasuryAlertAcknowledgeRequestSchema.parse(input)
  const res = await api.post(`/admin/treasury/alerts/${id}/acknowledge`, body)
  return TreasuryAlertSchema.parse(res.data)
}

/** GET /admin/treasury/withdrawal-policies — active per-wallet controls (read-only). */
export async function listWithdrawalPolicies(): Promise<WithdrawalPolicyListResponse> {
  const res = await api.get("/admin/treasury/withdrawal-policies")
  return WithdrawalPolicyListResponseSchema.parse(res.data)
}

/** GET /admin/treasury/sweeps — child-address gas-sweep state + threshold. */
export async function listTreasurySweeps(): Promise<TreasurySweepListResponse> {
  const res = await api.get("/admin/treasury/sweeps")
  return TreasurySweepListResponseSchema.parse(res.data)
}

/** GET /admin/treasury/payout-queue — pending payouts / withdrawals (read-only). */
export async function listTreasuryPayoutQueue(): Promise<TreasuryPayoutQueueResponse> {
  const res = await api.get("/admin/treasury/payout-queue")
  return TreasuryPayoutQueueResponseSchema.parse(res.data)
}

/** GET /admin/treasury/fiat-float — NGN fiat float vs the configured target. */
export async function listTreasuryFiatFloat(): Promise<TreasuryFiatFloatResponse> {
  const res = await api.get("/admin/treasury/fiat-float")
  return TreasuryFiatFloatResponseSchema.parse(res.data)
}

/** GET /admin/treasury/fx-position — FX net position + exposure headroom. */
export async function listTreasuryFxPosition(): Promise<TreasuryFxPositionResponse> {
  const res = await api.get("/admin/treasury/fx-position")
  return TreasuryFxPositionResponseSchema.parse(res.data)
}
