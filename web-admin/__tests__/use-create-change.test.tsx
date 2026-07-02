/**
 * useCreateChange hook test (Phase 7, WRITES).
 *
 * The maker's "raise a change request" mutation (used by the transaction-detail
 * Refund action to raise a `kind: refund` request). Asserts it:
 *  1. posts the input through the typed `createChange` client, and
 *  2. on success invalidates BOTH the approvals inbox (so the new pending request
 *     appears) AND the transactions prefix (so a drilled-in tx reflects it).
 *
 * The api client is mocked — no server. Invalidation is asserted against a real
 * QueryClient's `invalidateQueries` spy.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { ChangeRequest, CreateChangeRequest } from "@handshake-agent/contracts"

import { useCreateChange } from "@/lib/query/hooks"

vi.mock("@/lib/api/approvals", () => ({
  createChange: vi.fn(),
}))

import { createChange } from "@/lib/api/approvals"

const mockCreateChange = vi.mocked(createChange)

const INPUT: CreateChangeRequest = {
  kind: "refund",
  resource: "Transaction:11111111-1111-4111-8111-111111111111",
  payload: {
    transactionId: "11111111-1111-4111-8111-111111111111",
    reason: "Duplicate charge",
  },
  reason: "Duplicate charge",
}

const RESULT: ChangeRequest = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "refund",
  resource: INPUT.resource,
  payload: INPUT.payload,
  status: "pending",
  reason: "Duplicate charge",
  requestedByAdminId: "00000000-0000-0000-0000-000000000001",
  requestedByEmail: "ops@example.com",
  decidedByAdminId: null,
  decidedByEmail: null,
  decisionReason: null,
  decidedAt: null,
  createdAt: "2026-07-01T13:30:00.000Z",
}

beforeEach(() => {
  mockCreateChange.mockReset()
  mockCreateChange.mockResolvedValue(RESULT)
})

describe("useCreateChange", () => {
  it("posts the request and invalidates the inbox + transactions on success", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useCreateChange(), { wrapper })
    await result.current.mutateAsync(INPUT)

    expect(mockCreateChange).toHaveBeenCalledWith(INPUT)
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "approvals", "inbox"],
      })
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "transactions"],
      })
    })
  })
})
