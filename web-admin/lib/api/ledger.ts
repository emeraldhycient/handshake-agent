/**
 * Typed admin ledger API clients — read-only double-entry ledger oversight plus a
 * per-transaction integrity check (Phase 3, sub-area A). Each parses the response
 * through its contract schema (§3.3 / §8: the FE gate is UX, never the only check;
 * shapes that cross the boundary come from contracts).
 *
 * The history query triple (accountType, accountId, currency) is an internal read
 * query scoped to the presentation layer of the API — it is not a cross-boundary
 * request body, so the param shape is declared locally here (mirrors the API DTO).
 * Verify NEVER mutates: it re-sums existing legs and reports whether each currency
 * nets to zero (§3.1).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminLedgerHistoryResponseSchema,
  AdminLedgerIntegrityResultSchema,
  AdminLedgerIntegritySummarySchema,
  AdminLedgerListResponseSchema,
  type AdminLedgerHistoryResponse,
  type AdminLedgerIntegrityResult,
  type AdminLedgerIntegritySummary,
  type AdminLedgerListQuery,
  type AdminLedgerListResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** The account-scoped ledger-history query (mirrors the API presentation DTO). */
export interface LedgerHistoryQuery {
  accountType: string
  accountId: string
  currency: string
  limit?: number
}

/** GET /admin/ledger — an account's posted ledger entries (newest first). */
export async function listLedgerHistory(
  query: LedgerHistoryQuery
): Promise<AdminLedgerHistoryResponse> {
  const res = await api.get("/admin/ledger", { params: query })
  return AdminLedgerHistoryResponseSchema.parse(res.data)
}

/**
 * GET /admin/ledger/all — the GLOBAL cross-account browse: legs across ALL
 * accounts filtered by an optional accountType and/or currency, newest-first,
 * keyset-paginated (opaque `cursor` in, `nextCursor` out). Read-only (§3.1).
 */
export async function listGlobalLedger(
  query: AdminLedgerListQuery
): Promise<AdminLedgerListResponse> {
  const res = await api.get("/admin/ledger/all", { params: query })
  return AdminLedgerListResponseSchema.parse(res.data)
}

/**
 * GET /admin/ledger/export — a CSV of ALL ledger legs matching the current global-
 * browse filters (cursor/limit ignored server-side). Read-only (§3.1). Returns the
 * raw Blob for `downloadFile`; the server records an `admin_export` audit event.
 */
export async function exportLedger(
  query: AdminLedgerListQuery,
  reason?: string
): Promise<Blob> {
  const res = await api.get<Blob>("/admin/ledger/export", {
    params: reason ? { ...query, reason } : query,
    responseType: "blob",
  })
  return res.data
}

/**
 * GET /admin/ledger/integrity — the GLOBAL sequence-integrity summary that feeds
 * the header pill (gap/reorder detection across every sub-ledger). Read-only.
 */
export async function getLedgerIntegrity(): Promise<AdminLedgerIntegritySummary> {
  const res = await api.get("/admin/ledger/integrity")
  return AdminLedgerIntegritySummarySchema.parse(res.data)
}

/** POST /admin/ledger/verify/:transactionId — re-sum a transaction's legs (read-only). */
export async function verifyLedger(
  transactionId: string
): Promise<AdminLedgerIntegrityResult> {
  const res = await api.post(`/admin/ledger/verify/${transactionId}`, {})
  return AdminLedgerIntegrityResultSchema.parse(res.data)
}
