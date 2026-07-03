/**
 * Typed asset-catalog discovery API client (root CLAUDE.md §7 — the capability/service
 * registry). Two routes on `/admin/config/assets` surface the Blockradar-driven asset
 * discovery so an operator can re-sync on demand and review what the provider found:
 *
 *   GET  /admin/config/assets/discovered — the newly-discovered assets awaiting review
 *   POST /admin/config/assets/sync       — re-run discovery against the live wallet(s)
 *
 * Neither moves money (§3.1): discovery reads the provider's asset listing. The sync is
 * step-up-gated server-side (it may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps
 * it in `useStepUpRetry`) + immutably audited. Responses are parsed through the contract
 * schema after the request (§8). This file lives in `lib/` — no `components/`/`app/` imports.
 */
import {
  AdminAssetsSyncResponseSchema,
  AdminDiscoveredAssetListResponseSchema,
  type AdminAssetsSyncResponse,
  type AdminDiscoveredAssetListResponse,
} from "@handshake-agent/contracts";

import { api } from "./client";

/** GET /admin/config/assets/discovered — newly-discovered (not-yet-catalogued) assets. */
export async function listDiscoveredAssets(): Promise<AdminDiscoveredAssetListResponse> {
  const res = await api.get("/admin/config/assets/discovered");
  return AdminDiscoveredAssetListResponseSchema.parse(res.data);
}

/** POST /admin/config/assets/sync — trigger a Blockradar catalog re-sync. */
export async function syncAssets(): Promise<AdminAssetsSyncResponse> {
  const res = await api.post("/admin/config/assets/sync");
  return AdminAssetsSyncResponseSchema.parse(res.data);
}
