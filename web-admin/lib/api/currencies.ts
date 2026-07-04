/**
 * Typed runtime "Add currency" (custom-fiat) API client (root CLAUDE.md §7 — the
 * capability/service registry: adding a currency is a runtime, admin-gated config
 * change, not a code change). Three routes on `/admin/config/currencies`:
 *
 *   GET   /admin/config/currencies         — list the runtime custom fiats
 *   POST  /admin/config/currencies         — add one (created DISABLED; the
 *                                            enabled-needs-pricing invariant is
 *                                            fail-closed + re-checked server-side)
 *   PATCH /admin/config/currencies/:code   — enable/disable and/or edit its metadata
 *
 * None of these move money (§3.1): a custom fiat is a catalog listing, not a
 * transaction. Each write is step-up-gated (may 403 with ADMIN_STEP_UP_REQUIRED —
 * the caller wraps it in `useStepUpRetry`) + immutably audited on the server, which
 * re-validates the request (§3.3: the FE parse below is defence-in-depth, never the
 * only gate). Bodies are parsed through the request schema before the request fires
 * and responses after (§8: shapes that cross the boundary come from contracts).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminCustomFiatCreateRequestSchema,
  AdminCustomFiatListResponseSchema,
  AdminCustomFiatSchema,
  AdminCustomFiatUpdateRequestSchema,
  type AdminCustomFiat,
  type AdminCustomFiatCreateRequest,
  type AdminCustomFiatListResponse,
  type AdminCustomFiatUpdateRequest,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/config/currencies — the runtime custom fiats (enabled and disabled). */
export async function listCustomFiats(): Promise<AdminCustomFiatListResponse> {
  const res = await api.get("/admin/config/currencies")
  return AdminCustomFiatListResponseSchema.parse(res.data)
}

/**
 * POST /admin/config/currencies — add a runtime custom currency. It is created
 * DISABLED (the fail-closed enabled-needs-pricing invariant, re-checked server-side).
 */
export async function addCurrency(
  input: AdminCustomFiatCreateRequest
): Promise<AdminCustomFiat> {
  const body = AdminCustomFiatCreateRequestSchema.parse(input)
  const res = await api.post("/admin/config/currencies", body)
  return AdminCustomFiatSchema.parse(res.data)
}

/**
 * PATCH /admin/config/currencies/:code — enable/disable and/or edit a custom
 * currency's display metadata. Enabling is fail-closed: the server rejects it unless
 * the currency has pricing configured.
 */
export async function updateCurrency(
  code: string,
  patch: AdminCustomFiatUpdateRequest
): Promise<AdminCustomFiat> {
  const body = AdminCustomFiatUpdateRequestSchema.parse(patch)
  const res = await api.patch(
    `/admin/config/currencies/${encodeURIComponent(code)}`,
    body
  )
  return AdminCustomFiatSchema.parse(res.data)
}
