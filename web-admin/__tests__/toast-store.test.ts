/**
 * Toast store tests.
 *
 * The store owns the ephemeral toast queue (design `toast(msg, kind)` →
 * `toasts:[...]` state, dismissed by id). It is UI-only client state (Zustand),
 * never a server cache. Auto-dismiss timing lives in the Toaster component, not
 * here — the store stays a pure, synchronous, testable factory.
 */
import { describe, expect, it } from "vitest"

import { createToastStore } from "@/lib/store/toast-store"

describe("toast-store", () => {
  it("starts with an empty queue", () => {
    const store = createToastStore()
    expect(store.getState().toasts).toEqual([])
  })

  it("push appends a toast and returns its id; ids are unique + increasing", () => {
    const store = createToastStore()

    const first = store.getState().push("Exporting audit log to CSV…", "info")
    const second = store.getState().push("Testing connection to Blockradar…")

    const { toasts } = store.getState()
    expect(toasts).toHaveLength(2)
    expect(toasts[0]).toMatchObject({
      id: first,
      message: "Exporting audit log to CSV…",
      kind: "info",
    })
    // Default kind is "ok" (design: `kind || 'ok'`).
    expect(toasts[1]).toMatchObject({ id: second, kind: "ok" })
    expect(second).toBeGreaterThan(first)
  })

  it("dismiss removes only the toast with the given id", () => {
    const store = createToastStore()
    const a = store.getState().push("first", "info")
    const b = store.getState().push("second", "warn")

    store.getState().dismiss(a)

    const { toasts } = store.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].id).toBe(b)
  })

  it("dismiss is a no-op for an unknown id", () => {
    const store = createToastStore()
    store.getState().push("only", "ok")

    store.getState().dismiss(9999)

    expect(store.getState().toasts).toHaveLength(1)
  })
})
