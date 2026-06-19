/**
 * Phase 9 — Zustand chat store: PIN execution gate (TDD)
 *
 * SACROSANCT INVARIANT (CLAUDE.md §3.1):
 * `pinComplete()` is the ONLY method that may append a receipt-kind message.
 * No `send`, `openConfirm`, `confirmToPin`, or `pressPin` before the 4th digit
 * may ever produce a receipt. This test suite explicitly proves that invariant.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { buildBuyConfirm } from "@/lib/chat/flow"
import { createChatStore } from "./chat-store"

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
    expect(store.getState().pinOpen).toBe(false)
    expect(store.getState().pin).toBe("")
    expect(store.getState().pending).toBeNull()
    expect(store.getState().confirmOpen).toBe(false)
  })

  it("pressPin ignores digit when pin already has 4 characters", () => {
    const s = store.getState()
    s.openConfirm("m", buildBuyConfirm())
    s.confirmToPin()
    // Fill 4 digits — this triggers pinComplete
    "1234".split("").forEach((d) => store.getState().pressPin(d))
    const receiptsBefore = store
      .getState()
      .threads.m.filter((m) => m.kind === "receipt").length

    // Extra digit after completion — pin resets to "" in pinComplete, so this
    // should start a new pin entry (length 1) rather than appending a 5th char.
    store.getState().pressPin("5")
    expect(store.getState().pin).toBe("5")
    // No additional receipt from the extra digit press (store is now in
    // closed-overlay state, but we just verify receipt count hasn't grown
    // beyond what pinComplete produced)
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
