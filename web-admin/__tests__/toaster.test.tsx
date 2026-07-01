/**
 * Toaster tests.
 *
 * The Toaster renders the toast-store queue as a fixed, bottom-right stack and
 * owns the design's 2600ms auto-dismiss timer (kept out of the pure store). It
 * is a polite live region so screen readers announce confirmations without
 * stealing focus.
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"

import { Toaster } from "@/components/shared/toaster"
import { defaultToastStore, pushToast } from "@/lib/store/toast-store"

afterEach(() => {
  // The Toaster binds the singleton store — reset it between tests.
  defaultToastStore.setState({ toasts: [] })
  vi.useRealTimers()
})

describe("Toaster", () => {
  it("renders queued toasts inside a polite live region", () => {
    pushToast("Exporting audit log to CSV…", "info")

    render(<Toaster />)

    expect(screen.getByRole("status")).toBeInTheDocument()
    expect(screen.getByText("Exporting audit log to CSV…")).toBeInTheDocument()
  })

  it("auto-dismisses a toast after the design's 2600ms window", () => {
    vi.useFakeTimers()
    pushToast("Testing connection to Blockradar…", "info")

    render(<Toaster />)
    expect(
      screen.getByText("Testing connection to Blockradar…")
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2600)
    })

    expect(
      screen.queryByText("Testing connection to Blockradar…")
    ).not.toBeInTheDocument()
  })
})
