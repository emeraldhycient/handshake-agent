/**
 * Typed admin catalog API client (Phase 6b) — READ-ONLY view of the FULL asset +
 * fiat catalog (enabled AND disabled) for the Configuration group's Asset /
 * Currency catalog screens.
 *
 * Why not the public `GET /config` (getPublicConfig): that endpoint is
 * enabled-only and secret-stripped, so it cannot show the paused/off listings or
 * the per-entry live status the admin screens render. `GET /admin/config/catalog`
 * surfaces the whole catalog with each entry's `live` flag (no secret fields).
 * Live-status edits are Phase 7.
 *
 * The response is parsed through `AdminCatalogViewSchema` after the request
 * (§8: shapes that cross the boundary come from contracts; §3.3: the FE parse is
 * defence-in-depth, never the only gate).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminCatalogViewSchema,
  type AdminCatalogView,
} from "@handshake-agent/contracts"

import { api } from "./client"

/**
 * GET /admin/config/catalog — the full asset + fiat catalog (incl. disabled),
 * each row carrying its effective `live` status. No secret/infra fields.
 */
export async function getAdminCatalog(): Promise<AdminCatalogView> {
  const res = await api.get("/admin/config/catalog")
  return AdminCatalogViewSchema.parse(res.data)
}
