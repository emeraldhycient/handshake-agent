/**
 * Typed admin beneficiary-oversight API clients (Phase 3, sub-area D) — read-only
 * listing of saved payout destinations plus the first-use cooling-off override.
 * Each parses the response through its contract schema (§3.3 / §8: the FE gate is
 * UX, never the only check; shapes that cross the boundary come from contracts).
 *
 * The override is a step-up-gated POST with no body (204 on success); it clears a
 * first-use lock (IDN-08) and may 403 with ADMIN_STEP_UP_REQUIRED, so the caller
 * wraps it in `useStepUpRetry`. Nothing here moves money (§3.1).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminBeneficiaryListResponseSchema,
  type AdminBeneficiaryListResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/beneficiaries — saved payout destinations (optionally per user). */
export async function listBeneficiaries(
  userId?: string
): Promise<AdminBeneficiaryListResponse> {
  const params = userId ? { userId } : undefined
  const res = await api.get("/admin/beneficiaries", { params })
  return AdminBeneficiaryListResponseSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function overrideCoolingOff(id: string): Promise<void> {
  await api.post(`/admin/beneficiaries/${id}/cooling-off-override`, {})
}
