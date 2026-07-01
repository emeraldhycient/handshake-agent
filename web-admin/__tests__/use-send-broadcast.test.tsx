/**
 * useSendBroadcast hook test (Phase 7, WRITES).
 *
 * The Comms composer's broadcast send. Asserts it:
 *  1. posts the request through the typed `sendBroadcast` client, and
 *  2. on success invalidates BOTH the delivery log (new outbox rows appear) AND the
 *     approvals inbox (a large-audience send queues a maker-checker request).
 *
 * The api client is mocked — no server; a broadcast moves no money (§3.1).
 * Invalidation is asserted against a real QueryClient's `invalidateQueries` spy.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type {
  BroadcastSendRequest,
  BroadcastSendResponse,
} from "@handshake-agent/contracts"

import { useSendBroadcast } from "@/lib/query/hooks"

vi.mock("@/lib/api/notifications", () => ({
  sendBroadcast: vi.fn(),
}))

import { sendBroadcast } from "@/lib/api/notifications"

const mockSendBroadcast = vi.mocked(sendBroadcast)

const INPUT: BroadcastSendRequest = {
  audience: "tier_1",
  templateKey: "promo_ticketing",
  schedule: { kind: "now" },
  reason: "Launch promo",
}

const RESULT: BroadcastSendResponse = {
  outcome: "dispatched",
  recipientCount: 8920,
  changeRequestId: null,
}

beforeEach(() => {
  mockSendBroadcast.mockReset()
  mockSendBroadcast.mockResolvedValue(RESULT)
})

describe("useSendBroadcast", () => {
  it("posts the request and invalidates the delivery log + approvals inbox on success", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSendBroadcast(), { wrapper })
    const res = await result.current.mutateAsync(INPUT)

    expect(mockSendBroadcast).toHaveBeenCalledWith(INPUT)
    expect(res).toEqual(RESULT)
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "notifications", "delivery-log"],
      })
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "approvals", "inbox"],
      })
    })
  })

  it("surfaces a queued-for-approval outcome for a large audience", async () => {
    mockSendBroadcast.mockResolvedValue({
      outcome: "queued_for_approval",
      recipientCount: 31204,
      changeRequestId: "44444444-4444-4444-8444-444444444444",
    })
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSendBroadcast(), { wrapper })
    const res = await result.current.mutateAsync({ ...INPUT, audience: "all" })

    expect(res.outcome).toBe("queued_for_approval")
    expect(res.changeRequestId).not.toBeNull()
  })
})
