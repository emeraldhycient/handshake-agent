/**
 * Admin global-search API client (go-readiness #14). Parses the response through
 * the contract schema. Read-only — the palette only navigates to the returned
 * in-app hrefs; nothing here moves money (§3.1). Lives in `lib/`.
 */
import {
  AdminSearchResponseSchema,
  type AdminSearchResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/search?q= — live entity search (users + transactions). */
export async function getAdminSearch(q: string): Promise<AdminSearchResponse> {
  const res = await api.get("/admin/search", { params: { q } })
  return AdminSearchResponseSchema.parse(res.data)
}
