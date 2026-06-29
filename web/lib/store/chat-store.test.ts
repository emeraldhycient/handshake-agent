/**
 * Phase 9 — Zustand chat store: PIN execution gate (TDD)
 *
 * SACROSANCT INVARIANT (CLAUDE.md §3.1):
 * `pinComplete()` is the ONLY method that may append a receipt-kind message.
 * No `send`, `openConfirm`, `confirmToPin`, or `pressPin` before the 4th digit
 * may ever produce a receipt. This test suite explicitly proves that invariant.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildBuyConfirm } from "@/lib/chat/flow"
import { createChatStore } from "./chat-store"
import type {
  WebChatResponse,
  ChatMessageRequest,
  ChatHistoryItem,
  BuyProposalConfirmation,
} from "@handshake-agent/contracts"

/** Synchronous scheduler — no setTimeout in tests */
const immediate = (fn: () => void) => fn()

describe("chat store", () => {
  let store: ReturnType<typeof createChatStore>

  beforeEach(() => {
    store = createChatStore({ schedule: immediate })
  })

  // ─── send ────────────────────────────────────────────────────────────────────

  it("send appends user msg then assistant messages (quote flow)", () => {
    store.getState().send("m", "Buy ₦50,000 of USDT", "buy")
    const t = store.getState().threads.m

    // The greeting is message [0]; user msg is second-to-last-before-quote group.
    // With the immediate scheduler: greeting + user msg + text + quote = 4 messages.
    const userMsg = t.find((m) => m.role === "user")
    expect(userMsg).toBeDefined()
    expect(userMsg?.kind).toBe("text")

    // Last message should be the quote card.
    expect(t.at(-1)).toMatchObject({ kind: "quote" })

    // typing flag cleared after schedule fires.
    expect(store.getState().typing.m).toBe(false)
  })

  it("send with action='buy' resolves correct assistant messages", () => {
    store.getState().send("m", "Buy ₦50,000 of USDT", "buy")
    const thread = store.getState().threads.m

    // We expect: greeting (assistant text) + user msg + assistant text + quote card
    expect(thread.some((m) => m.kind === "quote")).toBe(true)
    expect(thread.some((m) => m.role === "user")).toBe(true)

    // typing must be false after the schedule fires
    expect(store.getState().typing.m).toBe(false)
  })

  it("send clears chips for the surface then restores follow-up chips after non-quote action", () => {
    // balance returns a balance card (not a quote), so chips are restored after
    store.getState().send("m", "what's my balance", "balance")
    // With immediate scheduler the schedule has already run and chips should be restored
    const chips = store.getState().chips.m
    expect(chips.length).toBeGreaterThan(0)
  })

  // ─── PIN execution gate — the invariant ─────────────────────────────────────

  it("openConfirm → confirmToPin → 3 digits → NO receipt (gate holds)", () => {
    const s = store.getState()
    s.openConfirm("m", buildBuyConfirm())
    expect(store.getState().confirmOpen).toBe(true)

    s.confirmToPin()
    expect(store.getState().pinOpen).toBe(true)
    expect(store.getState().confirmOpen).toBe(false)

    // Press only 3 digits — receipt must NOT appear
    "123".split("").forEach((d) => store.getState().pressPin(d))
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false
    )
    expect(store.getState().successOpen).toBe(false)
    expect(store.getState().pinOpen).toBe(true) // still open
  })

  it("openConfirm → confirmToPin → 4 digits → receipt + success, pinOpen false", () => {
    const s = store.getState()
    s.openConfirm("m", buildBuyConfirm())
    expect(store.getState().confirmOpen).toBe(true)

    s.confirmToPin()
    expect(store.getState().pinOpen).toBe(true)

    // No receipt before 4 digits
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false
    )

    "1234".split("").forEach((d) => store.getState().pressPin(d))

    // ONLY AFTER 4th digit:
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      true
    )
    expect(store.getState().successOpen).toBe(true)
    expect(store.getState().successText).toBe("Purchase complete")
    expect(store.getState().successSurface).toBe("m")
    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pin).toBe("")
    expect(store.getState().pending).toBeNull()
    expect(store.getState().confirmOpen).toBe(false)
  })

  it("pressPin after pinComplete (pin reset to '') starts fresh entry, does not duplicate receipt", () => {
    const s = store.getState()
    s.openConfirm("m", buildBuyConfirm())
    s.confirmToPin()
    // Fill 4 digits — this triggers pinComplete, which resets pin to ""
    "1234".split("").forEach((d) => store.getState().pressPin(d))
    const receiptsBefore = store
      .getState()
      .threads.m.filter((m) => m.kind === "receipt").length

    // After pinComplete, pin === "". Pressing another digit starts a fresh entry
    // (length 1), does not trigger another pinComplete (length never reaches 4),
    // and does not produce an additional receipt.
    store.getState().pressPin("5")
    expect(store.getState().pin).toBe("5")
    const receiptsAfter = store
      .getState()
      .threads.m.filter((m) => m.kind === "receipt").length
    expect(receiptsAfter).toBe(receiptsBefore)
  })

  // ─── cancel ──────────────────────────────────────────────────────────────────

  it("cancel clears pending and overlays with NO receipt appended", () => {
    const s = store.getState()
    s.openConfirm("m", buildBuyConfirm())
    s.cancel()

    expect(store.getState().confirmOpen).toBe(false)
    expect(store.getState().pending).toBeNull()
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false
    )
  })

  it("cancel from PIN screen clears pin and overlays with NO receipt", () => {
    const s = store.getState()
    s.openConfirm("m", buildBuyConfirm())
    s.confirmToPin()
    "12".split("").forEach((d) => store.getState().pressPin(d))
    s.cancel()

    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pin).toBe("")
    expect(store.getState().pending).toBeNull()
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false
    )
  })

  // ─── pinBack ─────────────────────────────────────────────────────────────────

  it("pinBack removes the last pin digit", () => {
    const s = store.getState()
    s.openConfirm("m", buildBuyConfirm())
    s.confirmToPin()
    s.pressPin("1")
    s.pressPin("2")
    s.pressPin("3")
    expect(store.getState().pin).toBe("123")
    s.pinBack()
    expect(store.getState().pin).toBe("12")
  })

  // ─── surface isolation ────────────────────────────────────────────────────────

  it("threads are isolated per surface (m vs d)", () => {
    // Send on desktop surface
    store.getState().send("d", "balance", "balance")

    const mLen = store.getState().threads.m.length
    const dLen = store.getState().threads.d.length

    // Desktop thread grew (greeting + user + assistant messages); mobile did not
    expect(dLen).toBeGreaterThan(mLen)
  })

  it("openConfirm overlaySurface tracks the surface that initiated the confirm", () => {
    store.getState().openConfirm("d", buildBuyConfirm())
    expect(store.getState().overlaySurface).toBe("d")
    expect(store.getState().confirmOpen).toBe(true)
  })

  it("pinComplete appends receipt to the correct surface thread", () => {
    // Initiate confirm from desktop surface
    store.getState().openConfirm("d", buildBuyConfirm())
    store.getState().confirmToPin()
    "1234".split("").forEach((d) => store.getState().pressPin(d))

    // Receipt in desktop thread
    expect(store.getState().threads.d.some((m) => m.kind === "receipt")).toBe(
      true
    )
    // Mobile thread untouched
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false
    )
  })

  // ─── setInput ────────────────────────────────────────────────────────────────

  it("setInput updates the input for the given surface only", () => {
    store.getState().setInput("m", "hello")
    expect(store.getState().input.m).toBe("hello")
    expect(store.getState().input.d).toBe("")
  })

  // ─── reset ───────────────────────────────────────────────────────────────────

  it("reset restores greeting + startChips and clears input for the surface", () => {
    store.getState().send("m", "Buy ₦50,000 of USDT", "buy")
    store.getState().setInput("m", "some text")
    store.getState().reset("m")

    const thread = store.getState().threads.m
    // Only the greeting message remains
    expect(thread.length).toBe(1)
    expect(thread[0].role).toBe("assistant")
    expect(thread[0].kind).toBe("text")
    expect(store.getState().chips.m.length).toBeGreaterThan(0)
    expect(store.getState().input.m).toBe("")
  })

  // ─── deterministic IDs ───────────────────────────────────────────────────────

  it("message ids are deterministic strings (not random) — no Math.random", () => {
    store.getState().send("m", "Buy ₦50,000 of USDT", "buy")
    const ids = store.getState().threads.m.map((m) => m.id)
    // All IDs must be defined strings
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true
    )
    // IDs must be unique within the thread
    expect(new Set(ids).size).toBe(ids.length)
    // IDs must not look like random UUIDs (they should be counter-based like "msg-1")
    expect(ids.some((id) => /^msg-\d+$/.test(id))).toBe(true)
  })

  // ─── empty send guard ─────────────────────────────────────────────────────────

  it("send with empty or whitespace-only text does nothing", () => {
    const before = store.getState().threads.m.length
    store.getState().send("m", "   ")
    expect(store.getState().threads.m.length).toBe(before)
    store.getState().send("m", "")
    expect(store.getState().threads.m.length).toBe(before)
  })

  // ─── unrecognized-intent fallback ────────────────────────────────────────────

  it("send with unrecognized text appends user msg + fallback TEXT reply, no quote/receipt, chips restored", () => {
    const threadBefore = store.getState().threads.m.length
    // "hello there" does not match any ChatAction keyword in parseIntent
    store.getState().send("m", "hello there")

    const thread = store.getState().threads.m
    // user message appended — sent messages are always kind "text"
    const userMsg = thread.find((m) => m.role === "user")
    expect(userMsg).toBeDefined()
    expect(userMsg?.kind).toBe("text")
    // Narrow to text kind to access .text
    if (userMsg?.kind === "text") {
      expect(userMsg.text).toBe("hello there")
    } else {
      throw new Error("Expected user message to be kind 'text'")
    }

    // Thread grew by exactly 2: user msg + fallback assistant text
    expect(thread.length).toBe(threadBefore + 2)

    // The assistant reply is a plain text message — no quote or receipt
    const lastMsg = thread.at(-1)!
    expect(lastMsg.role).toBe("assistant")
    expect(lastMsg.kind).toBe("text")
    if (lastMsg.kind === "text") {
      expect(typeof lastMsg.text).toBe("string")
      expect(lastMsg.text.length).toBeGreaterThan(0)
    }
    expect(thread.some((m) => m.kind === "quote")).toBe(false)
    expect(thread.some((m) => m.kind === "receipt")).toBe(false)

    // typing cleared
    expect(store.getState().typing.m).toBe(false)

    // startChips() restored for the surface
    expect(store.getState().chips.m.length).toBeGreaterThan(0)
  })

  // ─── successOpen auto-dismiss ────────────────────────────────────────────────

  it("successOpen is true immediately after pinComplete (auto-dismiss uses setTimeout, not injected scheduler)", () => {
    // The auto-dismiss uses a plain setTimeout(fn, 2000) so the injected
    // immediate scheduler does not prematurely close the overlay.
    // This means successOpen stays true right after pinComplete resolves.
    store.getState().openConfirm("m", buildBuyConfirm())
    store.getState().confirmToPin()
    "1234".split("").forEach((d) => store.getState().pressPin(d))

    // Success overlay is still open — auto-dismiss hasn't fired yet
    expect(store.getState().successOpen).toBe(true)
  })
})

// ─── buy execute flow (authenticated path) ───────────────────────────────────

describe("buy execute flow (authenticated path)", () => {
  const proposalId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

  function makeAuthApi() {
    return vi.fn<
      (
        id: string
      ) => Promise<
        import("@handshake-agent/contracts").AuthorizeProposalResponse
      >
    >(() =>
      Promise.resolve({
        directiveId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        nonce: "n0nce_secret",
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      })
    )
  }

  it("confirmToPin (authenticated) calls authorizeApi and opens pin pad", async () => {
    const authorizeApi = makeAuthApi()
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
    })
    const { openConfirm, confirmToPin } = store.getState()
    openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await confirmToPin()

    expect(authorizeApi).toHaveBeenCalledWith(proposalId)
    expect(store.getState().pinOpen).toBe(true)
    expect(store.getState().confirmOpen).toBe(false)
    expect(store.getState()._directiveId).toBe(
      "dddddddd-dddd-dddd-dddd-dddddddddddd"
    )
  })

  it("confirmToPin failure surfaces error on confirm sheet, does NOT open pin", async () => {
    const authorizeApi = vi.fn<
      (
        id: string
      ) => Promise<
        import("@handshake-agent/contracts").AuthorizeProposalResponse
      >
    >(() => Promise.reject(new Error("Unauthorized")))
    const store = createChatStore({ schedule: immediate, authorizeApi })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()

    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().confirmOpen).toBe(true)
    expect(store.getState().pinError).toBe("Unauthorized")
  })

  it("pinComplete (settling) appends pay_in card and starts polling", async () => {
    const transactionId = "tttttttt-tttt-tttt-tttt-tttttttttttt"
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn<
      (
        id: string,
        body: {
          directiveId: string
          nonce: string
          pin: string
          deviceFingerprint?: string
          idempotencyKey: string
        }
      ) => Promise<import("@handshake-agent/contracts").ExecuteProposalResponse>
    >(() =>
      Promise.resolve({
        transactionId,
        status: "settling" as const,
        payment: {
          accountNumber: "0123456789",
          bankName: "Test Bank",
          providerRef: "REF001",
          amount: "50250",
          currency: "NGN",
        },
      })
    )
    const pollApi = vi.fn<
      (
        id: string
      ) => Promise<
        import("@handshake-agent/contracts").TransactionStatusResponse
      >
    >(() =>
      Promise.resolve({
        id: transactionId,
        type: "buy",
        status: "settling",
        createdAt: new Date().toISOString(),
      })
    )

    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
      pollApi,
    })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    const msgs = store.getState().threads.m
    const payIn = msgs.find((m) => m.kind === "pay_in")
    expect(payIn).toBeDefined()
    if (payIn?.kind === "pay_in") {
      expect(payIn.accountNumber).toBe("0123456789")
      expect(payIn.bankName).toBe("Test Bank")
      expect(payIn.providerRef).toBe("REF001")
      expect(payIn.transactionId).toBe(transactionId)
    }
    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pending).toBeNull()
  })

  it("pinComplete (completed) appends receipt and opens success overlay", async () => {
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.resolve({
        transactionId: "tx-complete",
        status: "completed" as const,
      })
    )

    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    const msgs = store.getState().threads.m
    expect(msgs.some((m) => m.kind === "receipt")).toBe(true)
    expect(store.getState().successOpen).toBe(true)
    expect(store.getState().pinOpen).toBe(false)
  })

  it("pinComplete wrong PIN shows error on pin pad and re-opens it", async () => {
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() => Promise.reject(new Error("Incorrect PIN")))

    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "9999" })
    await store.getState().pinComplete()

    expect(store.getState().pinOpen).toBe(true)
    expect(store.getState().pin).toBe("")
    expect(store.getState().pinError).toBe("Incorrect PIN")
  })
})

// ─── sendToAgent ──────────────────────────────────────────────────────────────

function makeResponse(outcome: WebChatResponse["outcome"]): WebChatResponse {
  return {
    reply: { text: "ok" },
    outcome,
    conversationId: "00000000-0000-0000-0000-000000000001",
    messageId: "00000000-0000-0000-0000-000000000002",
  }
}

describe("sendToAgent", () => {
  let store: ReturnType<typeof createChatStore>
  let mockApi: ReturnType<
    typeof vi.fn<(body: ChatMessageRequest) => Promise<WebChatResponse>>
  >

  beforeEach(() => {
    mockApi = vi.fn<(body: ChatMessageRequest) => Promise<WebChatResponse>>()
    store = createChatStore({ schedule: immediate, chatApi: mockApi })
  })

  it("clarification outcome → text message + typing cleared", async () => {
    mockApi.mockResolvedValue(
      makeResponse({ kind: "clarification", text: "Please clarify?" })
    )
    await store.getState().sendToAgent("m", "do something")
    const thread = store.getState().threads.m
    const last = thread.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toBe("Please clarify?")
    expect(store.getState().typing.m).toBe(false)
  })

  it("receive outcome → receive-kind message", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "receive",
        deposit: {
          asset: "USDT",
          network: "TRON",
          address: "TXabcdef1234",
          minAmount: "10",
          etaText: "~5 min",
        },
      })
    )
    await store.getState().sendToAgent("m", "receive USDT")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("receive")
    if (last.kind === "receive") {
      expect(last.asset).toBe("USDT")
      expect(last.network).toBe("TRON")
      expect(last.address).toBe("TXabcdef1234")
    }
    expect(store.getState().typing.m).toBe(false)
  })

  it("proposal outcome → quote-kind message + pendingProposalId stashed", async () => {
    const proposalId = "11111111-1111-1111-1111-111111111111"
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "proposal",
        txType: "buy",
        proposalId,
        confirmation: {
          proposalId,
          asset: "USDT",
          fiatAmount: "50000",
          fiatCurrency: "NGN",
          cryptoAmount: "31.25",
          fxRate: "1600",
          spreadBps: 150,
          processingFeeBps: 50,
          processingFeeAmount: "250",
          totalFiat: "50250",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    )
    await store.getState().sendToAgent("m", "buy 50000 USDT")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("quote")
    expect(store.getState().pendingProposalId).toBe(proposalId)
    expect(store.getState().typing.m).toBe(false)
  })

  it("needs_kyc outcome → text message about verification", async () => {
    mockApi.mockResolvedValue(makeResponse({ kind: "needs_kyc" }))
    await store.getState().sendToAgent("m", "buy crypto")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toContain("verification")
    expect(store.getState().typing.m).toBe(false)
  })

  it("needs_beneficiary outcome (bank_account) → text message containing 'bank account'", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "bank_account",
      })
    )
    await store.getState().sendToAgent("m", "sell")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toContain("bank account")
    expect(store.getState().typing.m).toBe(false)
  })

  it("needs_beneficiary outcome (crypto_address) → text message containing 'crypto address'", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "crypto_address",
      })
    )
    await store.getState().sendToAgent("m", "send")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toContain("crypto address")
    expect(store.getState().typing.m).toBe(false)
  })

  it("not_supported outcome → 'not supported' text message", async () => {
    mockApi.mockResolvedValue(
      makeResponse({ kind: "not_supported", action: "swap" })
    )
    await store.getState().sendToAgent("m", "swap ETH to BTC")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toContain("not supported")
    expect(store.getState().typing.m).toBe(false)
  })

  it("error path → fallback error message + typing cleared", async () => {
    mockApi.mockRejectedValue(new Error("Network error"))
    await store.getState().sendToAgent("m", "something")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toContain("trouble")
    expect(store.getState().typing.m).toBe(false)
  })

  it("typing is never left stuck — even on error", async () => {
    mockApi.mockRejectedValue(new Error("500"))
    await store.getState().sendToAgent("m", "send")
    expect(store.getState().typing.m).toBe(false)
  })
})

// ─── hydrateHistory ─────────────────────────────────────────────────────────

const buyConfirmation: BuyProposalConfirmation = {
  proposalId: "11111111-1111-1111-1111-111111111111",
  asset: "USDT",
  fiatAmount: "50000",
  fiatCurrency: "NGN",
  cryptoAmount: "31.25",
  fxRate: "1600",
  spreadBps: 150,
  processingFeeBps: 50,
  processingFeeAmount: "250",
  totalFiat: "50250",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
}

function historyItem(over: Partial<ChatHistoryItem> = {}): ChatHistoryItem {
  return {
    messageId: "00000000-0000-0000-0000-000000000010",
    userText: "hi",
    outcome: null,
    createdAt: "2026-06-29T10:00:00.000Z",
    ...over,
  }
}

describe("hydrateHistory", () => {
  let store: ReturnType<typeof createChatStore>

  beforeEach(() => {
    store = createChatStore({ schedule: immediate })
  })

  it("rebuilds the thread after the greeting, oldest→newest, restoring proposalId", () => {
    const items: ChatHistoryItem[] = [
      historyItem({
        messageId: "00000000-0000-0000-0000-000000000001",
        userText: "where do I receive USDT?",
        outcome: {
          kind: "receive",
          deposit: { asset: "USDT", network: "TRON", address: "TXabc" },
        },
      }),
      historyItem({
        messageId: "00000000-0000-0000-0000-000000000002",
        userText: "buy 50000 USDT",
        outcome: {
          kind: "proposal",
          txType: "buy",
          proposalId: buyConfirmation.proposalId,
          confirmation: buyConfirmation,
        },
      }),
    ]
    store.getState().hydrateHistory("m", items)
    const t = store.getState().threads.m

    // greeting + (user, receive) + (user, quote)
    expect(t).toHaveLength(5)
    expect(t[0].role).toBe("assistant") // greeting preserved at index 0
    expect(t[1]).toMatchObject({
      role: "user",
      kind: "text",
      text: "where do I receive USDT?",
    })
    expect(t[2].kind).toBe("receive")
    expect(t[3]).toMatchObject({ role: "user", text: "buy 50000 USDT" })
    expect(t[4].kind).toBe("quote")
    expect(store.getState().pendingProposalId).toBe(buyConfirmation.proposalId)
  })

  it("appends only a user bubble when the outcome is null", () => {
    store
      .getState()
      .hydrateHistory("m", [
        historyItem({ userText: "stuck turn", outcome: null }),
      ])
    const t = store.getState().threads.m
    expect(t).toHaveLength(2)
    expect(t[1]).toMatchObject({
      role: "user",
      kind: "text",
      text: "stuck turn",
    })
  })

  it("never appends a receipt-kind message (invariant preserved)", () => {
    store.getState().hydrateHistory("m", [
      historyItem({
        outcome: {
          kind: "proposal",
          txType: "buy",
          proposalId: buyConfirmation.proposalId,
          confirmation: buyConfirmation,
        },
      }),
    ])
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false
    )
  })

  it("is idempotent — a second hydrate is a no-op", () => {
    const items = [historyItem({ userText: "once" })]
    store.getState().hydrateHistory("m", items)
    const len1 = store.getState().threads.m.length
    store.getState().hydrateHistory("m", items)
    expect(store.getState().threads.m.length).toBe(len1)
  })

  it("preserves messages already in the thread, inserting history after the greeting", () => {
    // A live mock send adds user + assistant messages before history arrives.
    store.getState().send("m", "Check my balance", "balance")
    const beforeLen = store.getState().threads.m.length
    store
      .getState()
      .hydrateHistory("m", [historyItem({ userText: "from history" })])
    const t = store.getState().threads.m
    expect(t.length).toBe(beforeLen + 1) // one user bubble inserted
    // The history bubble sits right after the greeting, before the live send.
    expect(t[1]).toMatchObject({ role: "user", text: "from history" })
    expect(t.some((m) => m.kind === "balance")).toBe(true)
  })

  it("hydrates surfaces independently", () => {
    store
      .getState()
      .hydrateHistory("m", [historyItem({ userText: "mobile only" })])
    expect(store.getState().threads.d).toHaveLength(1) // desktop untouched (greeting only)
    expect(store.getState().threads.m).toHaveLength(2)
  })
})
