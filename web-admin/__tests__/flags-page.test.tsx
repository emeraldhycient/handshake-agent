/**
 * FlagsPage — certification that an approved dual-control toggle actually flips.
 *
 * The design opens the MakerCheckerModal on toggle but never mutated the row.
 * These assert the real behaviour: clicking a switch opens the modal (no flip
 * yet), and only on "Submit for approval" does the row's `on` invert — the
 * switch's aria-checked flips, the `eval →` preview updates, and a toast fires.
 * Cancelling leaves the row untouched. No data-fetch; reactive useState only.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { FlagsPage } from "@/components/admin/flags-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("FlagsPage", () => {
  it("flips the switch + eval preview + toasts only after approval", async () => {
    const user = userEvent.setup()
    render(<FlagsPage />)

    // Seed row `swap.enabled` starts on (design mock).
    const toggle = screen.getByRole("switch", {
      name: /Disable swap\.enabled/i,
    })
    expect(toggle).toHaveAttribute("aria-checked", "true")

    // Clicking opens the maker-checker modal but does NOT flip yet (dual-control).
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "true")
    const dialog = screen.getByRole("dialog")
    expect(
      within(dialog).getByText(/Disable swap\.enabled/i)
    ).toBeInTheDocument()

    // Approving inverts the row: aria-checked flips, label swaps, eval → off.
    await user.click(
      within(dialog).getByRole("button", { name: /Submit for approval/i })
    )

    const flipped = screen.getByRole("switch", {
      name: /Enable swap\.enabled/i,
    })
    expect(flipped).toHaveAttribute("aria-checked", "false")
    // Scope the eval-preview assertion to swap.enabled's own row — other flags
    // that start off also render "eval → off", so an unscoped query is ambiguous.
    const flippedRow = flipped.closest("div")!
    expect(within(flippedRow).getByText(/eval → off/i)).toBeInTheDocument()

    // A confirmation toast names the flag + its new effective state.
    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/swap\.enabled/)
    expect(toasts[0].message).toMatch(/off/)
  })

  it("leaves the row unchanged when the modal is cancelled", async () => {
    const user = userEvent.setup()
    render(<FlagsPage />)

    const toggle = screen.getByRole("switch", {
      name: /Disable swap\.enabled/i,
    })
    await user.click(toggle)

    const dialog = screen.getByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: /Cancel/i }))

    // Still on; no toast fired.
    expect(
      screen.getByRole("switch", { name: /Disable swap\.enabled/i })
    ).toHaveAttribute("aria-checked", "true")
    expect(defaultToastStore.getState().toasts).toHaveLength(0)
  })
})
