/**
 * Typed blocked-entry (deny-list) API clients — the operator's surface for
 * gating a user / address / bank out of the money path. The list is append-only:
 * lifting a block SUPERSEDES the row rather than deleting it, so the history
 * stays auditable (§3.4). Each parses its input through the request schema
 * before the request fires and parses the response through the response schema
 * after (§3.3 / §8: the FE gate is UX, never the only check; shapes that cross
 * the boundary come from contracts).
 *
 * Add / supersede are sensitive and may 403 with ADMIN_STEP_UP_REQUIRED; the
 * caller wraps them in `useStepUpRetry`. Nothing here moves money (§3.1).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  BlockedEntrySchema,
  BlockedEntryListResponseSchema,
  BlockedEntryCreateRequestSchema,
  BlockedEntrySupersedeRequestSchema,
  type BlockedEntry,
  type BlockedEntryListResponse,
  type BlockedEntryCreateRequest,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/blocked — the deny-list (active + superseded rows). */
export async function listBlocked(): Promise<BlockedEntryListResponse> {
  const res = await api.get("/admin/blocked")
  return BlockedEntryListResponseSchema.parse(res.data)
}

/**
 * POST /admin/blocked — add a deny-list entry. Body parsed before send, the
 * created entry parsed after. Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED.
 */
export async function addBlocked(
  input: BlockedEntryCreateRequest
): Promise<BlockedEntry> {
  const body = BlockedEntryCreateRequestSchema.parse(input)
  const res = await api.post("/admin/blocked", body)
  return BlockedEntrySchema.parse(res.data)
}

/**
 * POST /admin/blocked/:id/supersede — lift (supersede) a deny-list entry. The
 * reason is a required audited justification. Sensitive — may 403 with
 * ADMIN_STEP_UP_REQUIRED.
 */
export async function supersedeBlocked(
  id: string,
  reason: string
): Promise<void> {
  const body = BlockedEntrySupersedeRequestSchema.parse({ reason })
  await api.post(`/admin/blocked/${id}/supersede`, body)
}
