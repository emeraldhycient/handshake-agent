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
import { greetingDesktop, GREETING_D } from "@/lib/constants"
import { ApiError, SESSION_EXPIRED_MESSAGE } from "@/lib/api/client"
import type {
  WebChatResponse,
  ChatMessageRequest,
  TransactionStatusResponse,
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

  // ─── desktop greeting personalization ─────────────────────────────────────────

  it("initial desktop greeting is the name-free generic (no hardcoded name)", () => {
    const greeting = store.getState().threads.d[0]
    expect(greeting.kind).toBe("text")
    expect(greeting.kind === "text" && greeting.text).toBe(GREETING_D)
    expect(greeting.kind === "text" && greeting.text).not.toMatch(/amara/i)
  })

  it("setDesktopGreeting personalizes the desktop greeting with the first name", () => {
    store.getState().setDesktopGreeting("Amara")
    const greeting = store.getState().threads.d[0]
    expect(greeting.kind === "text" && greeting.text).toBe(
      greetingDesktop("Amara")
    )
    expect(greeting.kind === "text" && greeting.text).toMatch(
      /welcome back, amara/i
    )
    // The greeting id is preserved (still the first message, not appended).
    expect(store.getState().threads.d).toHaveLength(1)
  })

  it("setDesktopGreeting with no name keeps the name-free greeting", () => {
    store.getState().setDesktopGreeting()
    const greeting = store.getState().threads.d[0]
    expect(greeting.kind === "text" && greeting.text).toBe(GREETING_D)
  })

  it("setDesktopGreeting does not touch the mobile thread", () => {
    store.getState().setDesktopGreeting("Amara")
    const mGreeting = store.getState().threads.m[0]
    expect(mGreeting.kind === "text" && mGreeting.text).not.toMatch(/amara/i)
  })

  it("setDesktopGreeting is a no-op once the conversation has started (never clobbers history)", () => {
    store.getState().send("d", "Buy ₦50,000 of USDT", "buy")
    const before = store.getState().threads.d
    store.getState().setDesktopGreeting("Amara")
    const after = store.getState().threads.d
    // Thread is unchanged — the greeting is only personalized on first load.
    expect(after).toEqual(before)
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

  it("pinComplete (settling) appends pay_in card and hands off to the live poller (no store interval)", async () => {
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

    // C4: the store no longer owns a setInterval poller — polling is the
    // PayInCardLive TanStack Query hook's job (stops on completed/failed, clears
    // on unmount). The store only records the settling tx + surface so the hook's
    // resolveSettlement callback can append the receipt to the right thread.
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
    // The live-poll handoff: the settling tx + its surface are tracked so the
    // component-driven hook can resolve completion/failure onto the right thread.
    expect(store.getState()._pollingTransactionId).toBe(transactionId)
    expect(store.getState()._settlingSurface).toBe("m")
  })

  it("marks the originating quote card terminal on confirm so its 'Review & confirm' stops being active", async () => {
    const transactionId = "uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu"
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.resolve({
        transactionId,
        status: "settling" as const,
        payment: {
          accountNumber: "0123456789",
          bankName: "Test Bank",
          providerRef: "REF002",
          amount: "50000",
          currency: "NGN",
        },
      })
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    // Seed a live quote card in the thread (as the agent flow would) — no
    // proposalStatus means the QuoteCard renders an active "Review & confirm".
    const quoteMsg = {
      id: "q1",
      role: "assistant" as const,
      kind: "quote" as const,
      action: "buy" as const,
      receiveAmt: "35.30 USDT",
      receiveSub: "You receive",
      rows: [],
      totalLabel: "Total charged",
      totalValue: "₦50,000.00",
      lockSeconds: 300,
    }
    store.setState({
      threads: { ...store.getState().threads, m: [quoteMsg] },
    })

    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    const quote = store.getState().threads.m.find((x) => x.kind === "quote")
    // Once confirmed, the spent quote is terminal — re-confirming would 409.
    expect(quote?.kind === "quote" && quote.proposalStatus).toBe("executed")
  })

  it("I8: pinComplete sends a STABLE idempotencyKey (= proposalId) so a retry cannot double-execute", async () => {
    const authorizeApi = makeAuthApi()
    let capturedKey: string | undefined
    const executeApi = vi.fn(
      (
        _id: string,
        body: {
          directiveId: string
          nonce: string
          pin: string
          deviceFingerprint?: string
          idempotencyKey: string
        }
      ) => {
        capturedKey = body.idempotencyKey
        return Promise.resolve({
          transactionId: "tx-complete",
          status: "completed" as const,
        })
      }
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

    // The key is the proposalId — stable across attempts, not a fresh per-confirm
    // uuid — so the server dedups a retried confirm instead of re-charging.
    expect(capturedKey).toBe(proposalId)
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

  it("pinComplete (completed) builds the receipt from the CONFIRMED payload, never the demo fixture", async () => {
    // Latent fake-receipt path: the immediate-completion branch used to append
    // buildReceipt() — a demo fixture with hardcoded ₦50,000 rows and a fake
    // "REF · HS-9F4C-22A1". The receipt must carry the confirmed proposal's own
    // amounts (here a GHS buy) and reference the real transaction id.
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.resolve({
        transactionId: "9a8b7c6d-0000-0000-0000-000000000000",
        status: "completed" as const,
      })
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", {
      title: "Confirm purchase",
      subtitle: "Check every detail — this can't be undone.",
      heroLabel: "You receive",
      heroAmount: "31.25 USDT",
      heroSub: "",
      rows: [
        { label: "You pay", value: "GH₵50,000.00" },
        { label: "Rate", value: "1 USDT = GH₵1,600.00" },
        { label: "Fee", value: "GH₵250.00" },
      ],
      totalLabel: "Total charged",
      totalValue: "GH₵50,250.00",
      cta: "Confirm with PIN",
      action: "buy",
    })
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    const receipt = store.getState().threads.m.find((m) => m.kind === "receipt")
    expect(receipt).toBeDefined()
    if (receipt?.kind === "receipt") {
      // Confirmed amounts, not the demo fixture's "+ 29.97 USDT" / ₦50,000 rows.
      expect(receipt.amount).toBe("31.25 USDT")
      expect(receipt.rows).toContainEqual({
        label: "Paid",
        value: "GH₵50,250.00",
      })
      // Real transaction reference — never the fixture "REF · HS-9F4C-22A1".
      expect(receipt.txRef).toBe("TX · 9a8b7c6d")
    }
    expect(store.getState().successOpen).toBe(true)
  })

  it("pinComplete (sell settling) appends a settling card with the payout reference", async () => {
    const transactionId = "ssssssss-ssss-ssss-ssss-ssssssssssss"
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.resolve({
        transactionId,
        status: "settling" as const,
        payout: { providerRef: "payout-ref-1" },
      })
    )

    // C4: the store no longer polls — the live SettlingCardLive hook does. This
    // test only asserts the settling card is appended on the settling response.
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", { ...buildBuyConfirm(), action: "send" })
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    const settling = store
      .getState()
      .threads.m.find((m) => m.kind === "settling")
    expect(settling).toBeDefined()
    if (settling?.kind === "settling") {
      expect(settling.txType).toBe("sell")
      expect(settling.reference).toBe("payout-ref-1")
      expect(settling.transactionId).toBe(transactionId)
    }
    expect(store.getState().pinOpen).toBe(false)
  })

  it("pinComplete (send settling) appends a settling card with the on-chain reference", async () => {
    const transactionId = "nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnnn"
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.resolve({
        transactionId,
        status: "settling" as const,
        onChain: { providerRef: "onchain-ref-1" },
      })
    )

    // C4: the store no longer polls — the live SettlingCardLive hook does.
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", { ...buildBuyConfirm(), action: "send" })
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    const settling = store
      .getState()
      .threads.m.find((m) => m.kind === "settling")
    expect(settling).toBeDefined()
    if (settling?.kind === "settling") {
      expect(settling.txType).toBe("send")
      expect(settling.reference).toBe("onchain-ref-1")
    }
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

  it("pinComplete with a real PIN-auth 401 (e.g. PIN_INVALID) re-opens the pin pad", async () => {
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.reject(new ApiError("Authorization failed.", 401))
    )
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

    // A wrong PIN / expired directive IS retryable → reopen the pad.
    expect(store.getState().pinOpen).toBe(true)
    expect(store.getState().pinError).toBe("Authorization failed.")
  })

  // ─── Finding #1: a dead session mid-execute must NOT re-prompt for a PIN ─────

  it("pinComplete session-expired 401 closes the pad and redirects (never pinError)", async () => {
    const authorizeApi = makeAuthApi()
    const onSessionExpired = vi.fn()
    const executeApi = vi.fn(() =>
      Promise.reject(new ApiError(SESSION_EXPIRED_MESSAGE, 401))
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
      onSessionExpired,
    })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    // The PIN pad is CLOSED (a PIN cannot fix a dead session) and pinError is
    // not set — it never masquerades as a wrong PIN.
    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pinError).toBeNull()
    const last = store.getState().threads.m.at(-1)!
    if (last.kind === "text")
      expect(last.text.toLowerCase()).toContain("session")
  })

  // ─── Finding #5: swap drift / unavailable / insufficient at execute time ────
  // must NOT be shown as "Incorrect PIN or expired session" — these are not PIN
  // errors and re-entering the PIN cannot fix them.

  it("pinComplete quote-drift (422) appends a chat message and CLOSES the pad (not pinError)", async () => {
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.reject(
        new ApiError("The quote changed. Please re-quote and try again.", 422)
      )
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", { ...buildBuyConfirm(), action: "swap" })
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    // Pad closed, no PIN error — the real cause surfaces as an assistant message.
    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pinError).toBeNull()
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toContain("quote changed")
  })

  it("pinComplete swap-unavailable (503) appends a chat message and CLOSES the pad", async () => {
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.reject(
        new ApiError("Service temporarily unavailable. Please try again.", 503)
      )
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", { ...buildBuyConfirm(), action: "swap" })
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pinError).toBeNull()
    const last = store.getState().threads.m.at(-1)!
    // A 503 is a generic infra failure → generic fallback copy, not pinError.
    if (last.kind === "text")
      expect(last.text).toContain("trouble reaching the assistant")
  })

  it("pinComplete insufficient-balance (422) appends a chat message and CLOSES the pad", async () => {
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.reject(
        new ApiError("Insufficient balance for this transaction.", 422)
      )
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", { ...buildBuyConfirm(), action: "swap" })
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pinError).toBeNull()
    const last = store.getState().threads.m.at(-1)!
    if (last.kind === "text")
      expect(last.text).toContain("Insufficient balance")
  })

  // ─── Finding #4: a swap that returns 'settling' renders a SWAP card ─────────

  it("pinComplete (swap settling) appends a settling card with swap copy + reference", async () => {
    const transactionId = "wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww"
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.resolve({
        transactionId,
        status: "settling" as const,
        swap: { providerSwapId: "swap-ref-1" },
      })
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
    })
    store.getState().openConfirm("m", { ...buildBuyConfirm(), action: "swap" })
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    const settling = store
      .getState()
      .threads.m.find((m) => m.kind === "settling")
    expect(settling).toBeDefined()
    if (settling?.kind === "settling") {
      expect(settling.txType).toBe("swap")
      expect(settling.reference).toBe("swap-ref-1")
      expect(settling.transactionId).toBe(transactionId)
      // Swap copy, NOT "Broadcasting your transfer on-chain" (the send copy).
      expect(settling.subtitle.toLowerCase()).toContain("swap")
      expect(settling.subtitle).not.toContain("Broadcasting your transfer")
    }
    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState()._settlingAction).toBe("swap")
  })
})

// ─── settlement resolution (C4: single poller + failed-state handling) ────────

describe("resolveSettlement (C4)", () => {
  const transactionId = "tttttttt-tttt-tttt-tttt-tttttttttttt"

  /** A store already tracking a settling buy (pay_in card live on surface "m"). */
  function settlingStore() {
    const store = createChatStore({ schedule: immediate })
    store.setState({
      _pollingTransactionId: transactionId,
      _settlingSurface: "m",
      _settlingAction: "buy",
      _settlingPending: buildBuyConfirm(),
    })
    return store
  }

  function tx(
    status: TransactionStatusResponse["status"]
  ): TransactionStatusResponse {
    return {
      id: transactionId,
      type: "buy",
      status,
      cryptoAmount: "6.5",
      asset: "USDT",
      fiatAmount: "10000",
      fiatCurrency: "NGN",
      createdAt: "2026-06-29T00:00:00.000Z",
    }
  }

  it("completed → appends a receipt, opens success overlay, stops tracking", () => {
    const store = settlingStore()
    store.getState().resolveSettlement(tx("completed"))

    const msgs = store.getState().threads.m
    expect(msgs.some((m) => m.kind === "receipt")).toBe(true)
    expect(store.getState().successOpen).toBe(true)
    // Tracking is cleared so nothing polls/resolves this tx again.
    expect(store.getState()._pollingTransactionId).toBeNull()
  })

  it("failed → surfaces the failure to the user, does NOT open success, stops tracking", () => {
    const store = settlingStore()
    store.getState().resolveSettlement(tx("failed"))

    const msgs = store.getState().threads.m
    // The failure is surfaced in-thread (not swallowed, not polled forever).
    expect(
      msgs.some(
        (m) =>
          m.kind === "text" &&
          /could not be completed|no funds/i.test((m as { text: string }).text)
      )
    ).toBe(true)
    expect(store.getState().successOpen).toBe(false)
    expect(store.getState()._pollingTransactionId).toBeNull()
  })

  it("is idempotent: a second resolve for the same tx is a no-op (guards repeated hook fires)", () => {
    const store = settlingStore()
    store.getState().resolveSettlement(tx("completed"))
    const countAfterFirst = store.getState().threads.m.length

    store.getState().resolveSettlement(tx("completed"))
    expect(store.getState().threads.m.length).toBe(countAfterFirst)
  })

  it("ignores non-terminal statuses (still settling → keep tracking, no message)", () => {
    const store = settlingStore()
    const before = store.getState().threads.m.length

    store.getState().resolveSettlement(tx("settling"))
    expect(store.getState().threads.m.length).toBe(before)
    expect(store.getState()._pollingTransactionId).toBe(transactionId)
  })

  it("buy receipt 'Paid' row uses the tx fiatCurrency symbol — NGN renders ₦ (audit #29)", () => {
    const store = settlingStore()
    store.getState().resolveSettlement(tx("completed"))

    const receipt = store
      .getState()
      .threads.m.find((m) => m.kind === "receipt") as
      | { rows: { label: string; value: string }[] }
      | undefined
    const paid = receipt?.rows.find((r) => r.label === "Paid")
    expect(paid?.value).toBe("₦10,000.00")
  })

  it("buy receipt 'Paid' row drives the symbol from a NON-NGN fiatCurrency, never hardcoded ₦ (audit #29)", () => {
    const store = settlingStore()
    store
      .getState()
      .resolveSettlement({ ...tx("completed"), fiatCurrency: "GHS" })

    const receipt = store
      .getState()
      .threads.m.find((m) => m.kind === "receipt") as
      | { rows: { label: string; value: string }[] }
      | undefined
    const paid = receipt?.rows.find((r) => r.label === "Paid")
    expect(paid?.value).toBe("GH₵10,000.00")
    expect(paid?.value).not.toContain("₦")
  })
})

// ─── onTransactionComplete (Bug 3 — refresh activity + balances on completion) ─

describe("onTransactionComplete callback", () => {
  const proposalId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
  const transactionId = "tttttttt-tttt-tttt-tttt-tttttttttttt"

  function makeAuthApi() {
    return vi.fn(() =>
      Promise.resolve({
        directiveId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        nonce: "n0nce_secret",
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      })
    )
  }

  it("fires on the IMMEDIATE-completion execute path (e.g. an instant internal transfer)", async () => {
    const onTransactionComplete = vi.fn()
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
      onTransactionComplete,
    })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()

    expect(onTransactionComplete).toHaveBeenCalledTimes(1)
  })

  it("fires when a settling transaction resolves to completed", () => {
    const onTransactionComplete = vi.fn()
    const store = createChatStore({
      schedule: immediate,
      onTransactionComplete,
    })
    store.setState({
      _pollingTransactionId: transactionId,
      _settlingSurface: "m",
      _settlingAction: "send",
      _settlingPending: buildBuyConfirm(),
    })
    store.getState().resolveSettlement({
      id: transactionId,
      type: "send",
      status: "completed",
      createdAt: "2026-06-29T00:00:00.000Z",
    })

    expect(onTransactionComplete).toHaveBeenCalledTimes(1)
  })

  it("does NOT fire while a transaction is still settling, nor on failure", async () => {
    const onTransactionComplete = vi.fn()
    const authorizeApi = makeAuthApi()
    const executeApi = vi.fn(() =>
      Promise.resolve({
        transactionId,
        status: "settling" as const,
        onChain: { providerRef: "REF001" },
      })
    )
    const store = createChatStore({
      schedule: immediate,
      authorizeApi,
      executeApi,
      onTransactionComplete,
    })
    store.getState().openConfirm("m", buildBuyConfirm())
    store.setState({ pendingProposalId: proposalId })
    await store.getState().confirmToPin()
    store.setState({ pin: "1234" })
    await store.getState().pinComplete()
    // Still in flight → no invalidation yet.
    expect(onTransactionComplete).not.toHaveBeenCalled()

    // Terminal failure → surfaced in-thread, but still no cache invalidation.
    store.getState().resolveSettlement({
      id: transactionId,
      type: "send",
      status: "failed",
      createdAt: "2026-06-29T00:00:00.000Z",
    })
    expect(onTransactionComplete).not.toHaveBeenCalled()
  })

  it("can be wired after construction via setTransactionCompleteHandler", () => {
    const onTransactionComplete = vi.fn()
    const store = createChatStore({ schedule: immediate })
    store.getState().setTransactionCompleteHandler(onTransactionComplete)
    store.setState({
      _pollingTransactionId: transactionId,
      _settlingSurface: "m",
      _settlingAction: "send",
      _settlingPending: buildBuyConfirm(),
    })
    store.getState().resolveSettlement({
      id: transactionId,
      type: "send",
      status: "completed",
      createdAt: "2026-06-29T00:00:00.000Z",
    })

    expect(onTransactionComplete).toHaveBeenCalledTimes(1)
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

// ─── sendVoiceToAgent ─────────────────────────────────────────────────────────

describe("sendVoiceToAgent", () => {
  it("sendVoiceToAgent appends the transcript as the user bubble + the outcome", async () => {
    const proposalId = "33333333-3333-3333-3333-333333333333"
    const voiceApi = vi.fn().mockResolvedValue({
      reply: { text: "ok" },
      transcript: "buy 50000 naira of usdt",
      conversationId: "11111111-1111-1111-1111-111111111111",
      messageId: "22222222-2222-2222-2222-222222222222",
      outcome: {
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
      },
    })
    const store = createChatStore({ schedule: (fn) => fn(), voiceApi })
    await store
      .getState()
      .sendVoiceToAgent("m", new Blob(["x"], { type: "audio/webm" }))
    const thread = store.getState().threads.m
    const user = thread.find((m) => m.role === "user")
    expect(user?.kind === "text" ? user.text : undefined).toBe(
      "buy 50000 naira of usdt"
    )
    expect(thread.some((m) => m.kind === "quote")).toBe(true)
    expect(store.getState().pendingProposalId).toBe(proposalId)
    expect(store.getState().typing.m).toBe(false)
  })

  it("binds a voice-produced needs_beneficiary card to the transcript so resolving re-sends it", async () => {
    // Pre-fix, sendVoiceToAgent neither set _lastIntentText nor bound the card,
    // so resolving a beneficiary card born from a voice note was a silent no-op.
    const voiceApi = vi.fn().mockResolvedValue({
      reply: { text: "ok" },
      transcript: "sell 5 usdt to my bank",
      conversationId: "11111111-1111-1111-1111-111111111111",
      messageId: "22222222-2222-2222-2222-222222222222",
      outcome: {
        kind: "needs_beneficiary",
        beneficiaryType: "bank_account",
      },
    })
    const chatApi = vi
      .fn()
      .mockResolvedValue(makeResponse({ kind: "clarification", text: "ok" }))
    const store = createChatStore({ schedule: (fn) => fn(), voiceApi, chatApi })
    await store
      .getState()
      .sendVoiceToAgent("m", new Blob(["x"], { type: "audio/webm" }))

    const card = store
      .getState()
      .threads.m.find((m) => m.kind === "needs_beneficiary")!
    await store
      .getState()
      .resolveBeneficiary("m", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", card.id)

    expect(chatApi).toHaveBeenCalledWith({
      text: "sell 5 usdt to my bank",
      beneficiaryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    })
  })

  it("sendVoiceToAgent sets _lastIntentText so a legacy resolve (no messageId) still works", async () => {
    const voiceApi = vi.fn().mockResolvedValue({
      reply: { text: "ok" },
      transcript: "send 2 usdt to dad",
      conversationId: "11111111-1111-1111-1111-111111111111",
      messageId: "22222222-2222-2222-2222-222222222222",
      outcome: {
        kind: "needs_beneficiary",
        beneficiaryType: "crypto_address",
      },
    })
    const chatApi = vi
      .fn()
      .mockResolvedValue(makeResponse({ kind: "clarification", text: "ok" }))
    const store = createChatStore({ schedule: (fn) => fn(), voiceApi, chatApi })
    await store
      .getState()
      .sendVoiceToAgent("m", new Blob(["x"], { type: "audio/webm" }))

    await store
      .getState()
      .resolveBeneficiary("m", "dddddddd-dddd-4ddd-8ddd-dddddddddddd")

    expect(chatApi).toHaveBeenCalledWith({
      text: "send 2 usdt to dad",
      beneficiaryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    })
  })

  it("sendVoiceToAgent error path → fallback error message + typing cleared", async () => {
    const voiceApi = vi.fn().mockRejectedValue(new Error("Network error"))
    const store = createChatStore({ schedule: (fn) => fn(), voiceApi })
    await store
      .getState()
      .sendVoiceToAgent("m", new Blob(["x"], { type: "audio/webm" }))
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") expect(last.text).toContain("trouble")
    expect(store.getState().typing.m).toBe(false)
  })

  it("sendVoiceToAgent 422 ApiError → surfaces the server message, not generic fallback", async () => {
    const voiceApi = vi
      .fn()
      .mockRejectedValue(new ApiError("Audio file too large", 422))
    const store = createChatStore({ schedule: (fn) => fn(), voiceApi })
    await store
      .getState()
      .sendVoiceToAgent("m", new Blob(["x"], { type: "audio/webm" }))
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") {
      expect(last.text).toBe("Audio file too large")
      expect(last.text).not.toContain("trouble reaching the assistant")
    }
    expect(store.getState().typing.m).toBe(false)
  })

  it("sendVoiceToAgent 500 ApiError → shows generic fallback", async () => {
    const voiceApi = vi
      .fn()
      .mockRejectedValue(new ApiError("Internal Server Error", 500))
    const store = createChatStore({ schedule: (fn) => fn(), voiceApi })
    await store
      .getState()
      .sendVoiceToAgent("m", new Blob(["x"], { type: "audio/webm" }))
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") {
      expect(last.text).toContain("trouble reaching the assistant")
    }
    expect(store.getState().typing.m).toBe(false)
  })
})

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

  it("needs_beneficiary outcome (bank_account) → needs_beneficiary card", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "bank_account",
      })
    )
    await store.getState().sendToAgent("m", "sell 10 usdt")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("needs_beneficiary")
    if (last.kind === "needs_beneficiary")
      expect(last.beneficiaryType).toBe("bank_account")
    expect(store.getState().typing.m).toBe(false)
  })

  it("needs_beneficiary outcome (crypto_address) → needs_beneficiary card", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "crypto_address",
      })
    )
    await store.getState().sendToAgent("m", "send 5 usdt")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("needs_beneficiary")
    if (last.kind === "needs_beneficiary")
      expect(last.beneficiaryType).toBe("crypto_address")
    expect(store.getState().typing.m).toBe(false)
  })

  it("resolveBeneficiary re-sends the last money request with the beneficiaryId", async () => {
    // First turn: needs_beneficiary for "sell 10 usdt".
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "bank_account",
      })
    )
    await store.getState().sendToAgent("m", "sell 10 usdt")

    // Second turn (after adding a beneficiary): proposal renders.
    const proposalId = "22222222-2222-2222-2222-222222222222"
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "proposal",
        txType: "sell",
        proposalId,
        confirmation: {
          proposalId,
          asset: "USDT",
          cryptoAmount: "10",
          fiatCurrency: "NGN",
          fxRate: "1600",
          processingFeeAmount: "80",
          netFiatAmount: "15920",
          beneficiaryLabel: "My GTB",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    )

    await store.getState().resolveBeneficiary("m", "ben-123")

    // The re-send used the stored last text + the beneficiaryId.
    expect(mockApi).toHaveBeenLastCalledWith({
      text: "sell 10 usdt",
      beneficiaryId: "ben-123",
    })
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("quote")
    expect(store.getState().pendingProposalId).toBe(proposalId)
  })

  // ─── Finding #3: resolving a STALE beneficiary card must re-send the intent ──
  // that card was created for — NOT whatever the user typed most recently.

  it("resolveBeneficiary re-sends the originating intent, not a later unrelated message", async () => {
    // Turn 1: "sell 10 usdt" → needs_beneficiary (a card bound to THIS text).
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "bank_account",
      })
    )
    await store.getState().sendToAgent("m", "sell 10 usdt")
    const card = store
      .getState()
      .threads.m.find((m) => m.kind === "needs_beneficiary")!
    expect(card.kind).toBe("needs_beneficiary")
    const cardId = card.id

    // Turn 2: the user types something else entirely (a balance check), which
    // overwrites the mutable _lastIntentText.
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "balance",
        fiatCurrency: "NGN",
        totalFiatValue: "100.00",
        balances: [],
      })
    )
    await store.getState().sendToAgent("m", "what's my balance")

    // Now resolve the OLD card. It must re-send "sell 10 usdt", not
    // "what's my balance".
    const proposalId = "33333333-3333-3333-3333-333333333333"
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "proposal",
        txType: "sell",
        proposalId,
        confirmation: {
          proposalId,
          asset: "USDT",
          cryptoAmount: "10",
          fiatCurrency: "NGN",
          fxRate: "1600",
          processingFeeAmount: "80",
          netFiatAmount: "15920",
          beneficiaryLabel: "My GTB",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    )
    await store.getState().resolveBeneficiary("m", "ben-9", cardId)

    expect(mockApi).toHaveBeenLastCalledWith({
      text: "sell 10 usdt",
      beneficiaryId: "ben-9",
    })
  })

  // ─── resolveSendRaw (Task 9: raw send-to-address destination) ────────────────

  it("resolveSendRaw re-sends the bound intent with a sendDestination", async () => {
    // Turn 1: "send 50 USDT to TRaw0000000001" → needs_beneficiary card bound
    // to THIS text (crypto_address, raw-send offered).
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "crypto_address",
      })
    )
    await store.getState().sendToAgent("m", "send 50 USDT to TRaw0000000001")
    const card = store
      .getState()
      .threads.m.find((m) => m.kind === "needs_beneficiary")!
    const cardId = card.id

    // Turn 2 (after the user confirms the raw destination): proposal renders.
    const proposalId = "44444444-4444-4444-4444-444444444444"
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "proposal",
        txType: "send",
        proposalId,
        confirmation: {
          proposalId,
          asset: "USDT",
          cryptoAmount: "50",
          network: "TRON",
          networkFeeCrypto: "1",
          totalDebit: "51",
          toAddressMasked: "TRaw00...0001",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    )

    await store.getState().resolveSendRaw(
      "m",
      {
        address: "TRaw0000000001",
        network: "TRON",
        saveAsBeneficiary: false,
      },
      cardId
    )

    // The re-send used the intent text bound to THIS card + the raw
    // sendDestination — never a beneficiaryId (§3.1: the destination is the
    // user-confirmed structured field, passed verbatim).
    expect(mockApi).toHaveBeenLastCalledWith({
      text: "send 50 USDT to TRaw0000000001",
      sendDestination: {
        address: "TRaw0000000001",
        network: "TRON",
        saveAsBeneficiary: false,
      },
    })
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("quote")
    expect(store.getState().pendingProposalId).toBe(proposalId)
  })

  it("resolveSendRaw falls back to _lastIntentText when no messageId is passed", async () => {
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "crypto_address",
      })
    )
    await store.getState().sendToAgent("m", "send 2 usdt to TRawLegacy001")

    const proposalId = "66666666-6666-6666-6666-666666666666"
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "proposal",
        txType: "send",
        proposalId,
        confirmation: {
          proposalId,
          asset: "USDT",
          cryptoAmount: "2",
          network: "TRON",
          networkFeeCrypto: "1",
          totalDebit: "3",
          toAddressMasked: "TRawLe...y001",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    )

    await store.getState().resolveSendRaw("m", {
      address: "TRawLegacy001",
      network: "TRON",
      saveAsBeneficiary: true,
      label: "Legacy",
    })

    expect(mockApi).toHaveBeenLastCalledWith({
      text: "send 2 usdt to TRawLegacy001",
      sendDestination: {
        address: "TRawLegacy001",
        network: "TRON",
        saveAsBeneficiary: true,
        label: "Legacy",
      },
    })
  })

  it("resolveSendRaw re-sends the originating intent, not a later unrelated message", async () => {
    // Turn 1: "send 50 USDT to TRawAAA0001" → needs_beneficiary card bound to
    // THIS text (crypto_address, raw-send offered).
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "needs_beneficiary",
        beneficiaryType: "crypto_address",
      })
    )
    await store.getState().sendToAgent("m", "send 50 USDT to TRawAAA0001")
    const card = store
      .getState()
      .threads.m.find((m) => m.kind === "needs_beneficiary")!
    const cardId = card.id

    // Turn 2: the user types something else entirely, overwriting the mutable
    // _lastIntentText.
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "balance",
        fiatCurrency: "NGN",
        totalFiatValue: "100.00",
        balances: [],
      })
    )
    await store.getState().sendToAgent("m", "what's my balance")

    // Resolve the OLD card with a raw destination. It must re-send
    // "send 50 USDT to TRawAAA0001" — never "what's my balance".
    const proposalId = "77777777-7777-7777-7777-777777777777"
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "proposal",
        txType: "send",
        proposalId,
        confirmation: {
          proposalId,
          asset: "USDT",
          cryptoAmount: "50",
          network: "TRON",
          networkFeeCrypto: "1",
          totalDebit: "51",
          toAddressMasked: "TRawAA...0001",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    )
    await store
      .getState()
      .resolveSendRaw(
        "m",
        { address: "TRawAAA0001", network: "TRON", saveAsBeneficiary: false },
        cardId
      )

    expect(mockApi).toHaveBeenLastCalledWith({
      text: "send 50 USDT to TRawAAA0001",
      sendDestination: {
        address: "TRawAAA0001",
        network: "TRON",
        saveAsBeneficiary: false,
      },
    })
  })

  // ─── choose_beneficiary (nickname disambiguation) ────────────────────────────

  it("choose_beneficiary outcome → picker card appended + typing cleared", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "choose_beneficiary",
        beneficiaryType: "crypto_address",
        nickname: "mum",
        candidates: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            label: "Mum",
            detail: "TQn9Y2...nH4d",
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            label: "Mum wallet",
            detail: "TXabcd...9z8y",
          },
        ],
      })
    )
    await store.getState().sendToAgent("m", "send 5 usdt to mum")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("choose_beneficiary")
    if (last.kind === "choose_beneficiary") {
      expect(last.nickname).toBe("mum")
      expect(last.candidates).toHaveLength(2)
    }
    expect(store.getState().typing.m).toBe(false)
  })

  it("resolving a choose_beneficiary card re-sends ITS bound intent with the chosen beneficiaryId", async () => {
    // Turn 1: "send 5 usdt to mum" → choose_beneficiary (card bound to THIS text).
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "choose_beneficiary",
        beneficiaryType: "crypto_address",
        nickname: "mum",
        candidates: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            label: "Mum",
            detail: "TQn9Y2...nH4d",
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            label: "Mum wallet",
            detail: "TXabcd...9z8y",
          },
        ],
      })
    )
    await store.getState().sendToAgent("m", "send 5 usdt to mum")
    const card = store
      .getState()
      .threads.m.find((m) => m.kind === "choose_beneficiary")!
    expect(card.kind).toBe("choose_beneficiary")

    // Turn 2: the user types something unrelated, overwriting _lastIntentText —
    // the picker must still resume the intent IT was created for.
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "balance",
        fiatCurrency: "NGN",
        totalFiatValue: "100.00",
        balances: [],
      })
    )
    await store.getState().sendToAgent("m", "what's my balance")

    // Resolve the picker with a chosen candidate id.
    const proposalId = "55555555-5555-5555-5555-555555555555"
    mockApi.mockResolvedValueOnce(
      makeResponse({
        kind: "proposal",
        txType: "send",
        proposalId,
        confirmation: {
          proposalId,
          asset: "USDT",
          cryptoAmount: "5",
          network: "TRON",
          networkFeeCrypto: "1",
          totalDebit: "6",
          toAddressMasked: "TQn9Y2...nH4d",
          beneficiaryLabel: "Mum",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    )
    await store
      .getState()
      .resolveBeneficiary("m", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", card.id)

    // The re-send used the intent text bound to the picker card + the chosen id
    // — the id is a LOOKUP result; the server re-validates ownership/type before
    // any proposal is created (§3.1).
    expect(mockApi).toHaveBeenLastCalledWith({
      text: "send 5 usdt to mum",
      beneficiaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("quote")
    expect(store.getState().pendingProposalId).toBe(proposalId)
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

  it("balance outcome → balance card with formatted total + asset rows", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "balance",
        fiatCurrency: "NGN",
        totalFiatValue: "16800.00",
        balances: [
          {
            asset: "USDT",
            network: "TRON",
            amount: "10.5",
            fiatValue: "16800.00",
          },
        ],
      })
    )
    await store.getState().sendToAgent("m", "what's my balance")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("balance")
    if (last.kind === "balance") {
      // total renders through formatFiat — the ₦ symbol + grouped thousands,
      // never the raw ISO code (matches the buy/sell cards).
      expect(last.total).toContain("₦")
      expect(last.total).toContain("16,800.00")
      expect(last.assets).toHaveLength(1)
      expect(last.assets[0].sym).toBe("USDT")
      expect(last.assets[0].name).toBe("Tether USD")
      expect(last.assets[0].amount).toBe("10.5 USDT")
      expect(last.assets[0].value).toBe("₦16,800.00")
    }
    expect(store.getState().typing.m).toBe(false)
  })

  it("balance outcome with no fiatValue → value/total fall back to em dash", async () => {
    mockApi.mockResolvedValue(
      makeResponse({
        kind: "balance",
        fiatCurrency: "NGN",
        asset: "USDT",
        balances: [{ asset: "USDT", network: "TRON", amount: "10.5" }],
      })
    )
    await store.getState().sendToAgent("m", "my USDT balance")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("balance")
    if (last.kind === "balance") {
      expect(last.total).toBe("—")
      expect(last.assets[0].value).toBe("—")
    }
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

  // ─── 4xx business error vs 5xx/network error distinction ─────────────────────

  it("4xx ApiError → surfaces the server message, not the generic fallback", async () => {
    mockApi.mockRejectedValue(new ApiError("Insufficient USDT balance", 422))
    await store.getState().sendToAgent("m", "sell 1000 usdt")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") {
      expect(last.text).toBe("Insufficient USDT balance")
      expect(last.text).not.toContain("trouble reaching the assistant")
    }
    expect(store.getState().typing.m).toBe(false)
  })

  it("5xx ApiError → shows generic fallback (not the raw server message)", async () => {
    mockApi.mockRejectedValue(new ApiError("Internal Server Error", 500))
    await store.getState().sendToAgent("m", "sell 1000 usdt")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") {
      expect(last.text).toContain("trouble reaching the assistant")
    }
    expect(store.getState().typing.m).toBe(false)
  })

  it("non-ApiError network error → shows generic fallback", async () => {
    mockApi.mockRejectedValue(new Error("Network Error"))
    await store.getState().sendToAgent("m", "buy 100 usdt")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") {
      expect(last.text).toContain("trouble reaching the assistant")
    }
    expect(store.getState().typing.m).toBe(false)
  })

  it("400 ApiError → surfaces the server validation message", async () => {
    mockApi.mockRejectedValue(new ApiError("RWF isn't live yet", 400))
    await store.getState().sendToAgent("m", "buy RWF")
    const last = store.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") {
      expect(last.text).toBe("RWF isn't live yet")
    }
    expect(store.getState().typing.m).toBe(false)
  })

  // ─── Finding #2: agent-step session expiry → redirect, not a dead-end bubble ─

  it("session-expired 401 in sendToAgent triggers the redirect handler (not a normal bubble)", async () => {
    const onSessionExpired = vi.fn()
    const s = createChatStore({
      schedule: immediate,
      chatApi: mockApi,
      onSessionExpired,
    })
    mockApi.mockRejectedValue(new ApiError(SESSION_EXPIRED_MESSAGE, 401))
    await s.getState().sendToAgent("m", "buy 100 usdt")

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    // The user sees a clear session-expired notice, NOT the raw message as a
    // generic assistant reply or the "trouble reaching the assistant" fallback.
    const last = s.getState().threads.m.at(-1)!
    expect(last.kind).toBe("text")
    if (last.kind === "text") {
      expect(last.text.toLowerCase()).toContain("session")
      expect(last.text.toLowerCase()).toContain("log")
    }
    expect(s.getState().typing.m).toBe(false)
  })

  it("setSessionExpiredHandler wires the redirect after construction", async () => {
    const onSessionExpired = vi.fn()
    store.getState().setSessionExpiredHandler(onSessionExpired)
    mockApi.mockRejectedValue(new ApiError(SESSION_EXPIRED_MESSAGE, 401))
    await store.getState().sendToAgent("m", "buy 100 usdt")
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it("a NON-session 401 in sendToAgent still surfaces the server message (not a redirect)", async () => {
    const onSessionExpired = vi.fn()
    const s = createChatStore({
      schedule: immediate,
      chatApi: mockApi,
      onSessionExpired,
    })
    mockApi.mockRejectedValue(new ApiError("Authorization failed.", 401))
    await s.getState().sendToAgent("m", "buy 100 usdt")
    expect(onSessionExpired).not.toHaveBeenCalled()
    const last = s.getState().threads.m.at(-1)!
    if (last.kind === "text") expect(last.text).toBe("Authorization failed.")
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

  it("binds a reloaded needs_beneficiary card to its intent so resolving after reload re-sends it", async () => {
    // Pre-fix, hydrateHistory never populated _beneficiaryIntents, so resolving
    // a reloaded card was a silent no-op (no _lastIntentText either).
    const chatApi = vi
      .fn()
      .mockResolvedValue(makeResponse({ kind: "clarification", text: "ok" }))
    const boundStore = createChatStore({ schedule: immediate, chatApi })
    boundStore.getState().hydrateHistory("m", [
      historyItem({
        userText: "sell 10 usdt to my gtb account",
        outcome: {
          kind: "needs_beneficiary",
          beneficiaryType: "bank_account",
        },
      }),
    ])
    const card = boundStore
      .getState()
      .threads.m.find((m) => m.kind === "needs_beneficiary")!

    await boundStore
      .getState()
      .resolveBeneficiary("m", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", card.id)

    expect(chatApi).toHaveBeenCalledWith({
      text: "sell 10 usdt to my gtb account",
      beneficiaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
  })

  it("binds a reloaded choose_beneficiary card to its intent the same way", async () => {
    const chatApi = vi
      .fn()
      .mockResolvedValue(makeResponse({ kind: "clarification", text: "ok" }))
    const boundStore = createChatStore({ schedule: immediate, chatApi })
    boundStore.getState().hydrateHistory("m", [
      historyItem({
        userText: "send 5 usdt to mum",
        outcome: {
          kind: "choose_beneficiary",
          beneficiaryType: "crypto_address",
          nickname: "mum",
          candidates: [
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              label: "Mum",
              detail: "TQn9…gk7r",
            },
          ],
        },
      }),
    ])
    const card = boundStore
      .getState()
      .threads.m.find((m) => m.kind === "choose_beneficiary")!

    await boundStore
      .getState()
      .resolveBeneficiary("m", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", card.id)

    expect(chatApi).toHaveBeenCalledWith({
      text: "send 5 usdt to mum",
      beneficiaryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    })
  })
})
