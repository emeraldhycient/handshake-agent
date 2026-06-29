import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchChatHistory, sendVoiceNote } from "./chat"
import { api } from "./client"

vi.mock("./client", () => ({ api: { get: vi.fn(), post: vi.fn() } }))

const getMock = api.get as unknown as ReturnType<typeof vi.fn>

const validHistory = {
  conversationId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  messages: [
    {
      messageId: "11111111-1111-1111-1111-111111111111",
      userText: "buy 50000 USDT",
      outcome: { kind: "needs_kyc" },
      createdAt: "2026-06-29T12:00:00.000Z",
    },
  ],
  nextCursor: null,
  hasMore: false,
}

describe("fetchChatHistory", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("GETs /chat/messages and returns the parsed history", async () => {
    getMock.mockResolvedValue({ data: validHistory })
    const result = await fetchChatHistory()
    expect(getMock).toHaveBeenCalledWith("/chat/messages", {
      params: undefined,
    })
    expect(result.messages[0].userText).toBe("buy 50000 USDT")
    expect(result.hasMore).toBe(false)
  })

  it("threads before + limit through as query params", async () => {
    getMock.mockResolvedValue({ data: validHistory })
    await fetchChatHistory({
      before: "11111111-1111-1111-1111-111111111111",
      limit: 10,
    })
    expect(getMock).toHaveBeenCalledWith("/chat/messages", {
      params: { before: "11111111-1111-1111-1111-111111111111", limit: 10 },
    })
  })

  it("throws when the response fails schema validation (UX gate)", async () => {
    getMock.mockResolvedValue({ data: { messages: "not-an-array" } })
    await expect(fetchChatHistory()).rejects.toThrow()
  })
})

describe("sendVoiceNote", () => {
  it("posts the blob as multipart and parses the response", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        reply: { text: "ok" },
        outcome: { kind: "clarification", text: "hi" },
        conversationId: "11111111-1111-1111-1111-111111111111",
        messageId: "22222222-2222-2222-2222-222222222222",
        transcript: "hello",
      },
    })
    const res = await sendVoiceNote(new Blob(["x"], { type: "audio/webm" }))
    expect(res.transcript).toBe("hello")
    const [url, body] = (api.post as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/chat/voice")
    expect(body).toBeInstanceOf(FormData)
  })
})
