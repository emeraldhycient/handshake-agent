import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildBuyConfirm } from "@/lib/chat/flow"
import { createChatStore } from "@/lib/store/chat-store"
import { qk } from "@/lib/query/keys"
import { useChatCacheInvalidation } from "./use-chat-cache-invalidation"

// chat-store lazily imports these at init — keep the module mock complete.
vi.mock("@/lib/api/chat", () => ({
  sendChatMessage: vi.fn(),
  sendVoiceNote: vi.fn(),
}))

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper, invalidate }
}

describe("useChatCacheInvalidation", () => {
  it("wires a completion handler that invalidates activity + balances caches", () => {
    const store = createChatStore({ schedule: (fn) => fn() })
    const { wrapper, invalidate } = makeWrapper()

    renderHook(() => useChatCacheInvalidation(store), { wrapper })
    invalidate.mockClear()

    // Drive a completed settlement — the store fires the wired handler.
    store.setState({
      _pollingTransactionId: "tttttttt-tttt-tttt-tttt-tttttttttttt",
      _settlingSurface: "m",
      _settlingAction: "send",
      _settlingPending: buildBuyConfirm(),
    })
    store.getState().resolveSettlement({
      id: "tttttttt-tttt-tttt-tttt-tttttttttttt",
      type: "send",
      status: "completed",
      createdAt: "2026-06-29T00:00:00.000Z",
    })

    const invalidatedKeys = invalidate.mock.calls.map((c) => c[0]?.queryKey)
    expect(invalidatedKeys).toContainEqual(qk.activity)
    expect(invalidatedKeys).toContainEqual(qk.balances)
  })
})
