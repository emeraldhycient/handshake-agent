import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createChatStore } from "@/lib/store/chat-store"
import { defaultAuthStore } from "@/lib/store/auth-store"
import { fetchChatHistory } from "@/lib/api/chat"
import { useChatHistory } from "./use-chat-history"

vi.mock("@/lib/api/chat", () => ({
  fetchChatHistory: vi.fn(),
  // chat-store imports sendChatMessage + sendVoiceNote; keep both present so the
  // module mock is complete (createChatStore reads defaultSendVoiceNote at init).
  sendChatMessage: vi.fn(),
  sendVoiceNote: vi.fn(),
}))
const fetchMock = fetchChatHistory as unknown as ReturnType<typeof vi.fn>

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper }
}

const history = {
  conversationId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  messages: [
    {
      messageId: "11111111-1111-1111-1111-111111111111",
      userText: "buy 50000 USDT",
      outcome: { kind: "needs_kyc" as const },
      createdAt: "2026-06-29T12:00:00.000Z",
    },
  ],
  nextCursor: null,
  hasMore: false,
}

describe("useChatHistory", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })
  afterEach(() => {
    defaultAuthStore.getState().clear()
  })

  it("fetches and hydrates the chat store when authenticated", async () => {
    defaultAuthStore.setState({ status: "authenticated", accessToken: "tok" })
    fetchMock.mockResolvedValue(history)
    const store = createChatStore({ schedule: (fn) => fn() })
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useChatHistory("m", store), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const thread = store.getState().threads.m
    expect(
      thread.some(
        (m) =>
          m.role === "user" && m.kind === "text" && m.text === "buy 50000 USDT"
      )
    ).toBe(true)
  })

  it("does not fetch or hydrate when anonymous", () => {
    defaultAuthStore.setState({ status: "anonymous", accessToken: null })
    const store = createChatStore({ schedule: (fn) => fn() })
    const { wrapper } = makeWrapper()

    renderHook(() => useChatHistory("m", store), { wrapper })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.getState().threads.m).toHaveLength(1) // greeting only
  })
})
