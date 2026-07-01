/**
 * AssetsPage — certification of the two interactive behaviours the design wires.
 *
 * FIX 1: the Live/Paused toggle-pill opens a maker-checker modal, and once the
 * change is submitted for approval the pill visibly flips (Live↔Paused) — the
 * catalog row's `live` flag is lifted into state and inverted on submit.
 *
 * FIX 2: "Sync Blockradar catalog" opens the ReasonModal; continuing it advances
 * the last-sync caption to "just now" and enqueues an info toast. Neither runs a
 * real probe (§3.1) — this is a design-mock reproduction of the destinations.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AssetsPage } from "@/components/admin/assets-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("AssetsPage", () => {
  it("flips a Live pill to Paused after the maker-checker change is submitted", async () => {
    const user = userEvent.setup()
    render(<AssetsPage />)

    // The first row (USDT · TRON) ships Live in the design seed.
    const toggle = screen.getByRole("button", {
      name: /Toggle USDT on TRON · TRC-20 live status/i,
    })
    expect(within(toggle).getByText("Live")).toBeInTheDocument()

    await user.click(toggle)

    // Approve the dual-control change → the pill inverts to Paused.
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    expect(within(toggle).getByText("Paused")).toBeInTheDocument()
  })

  it("advances last-sync and toasts when the Blockradar sync is continued", async () => {
    const user = userEvent.setup()
    render(<AssetsPage />)

    expect(screen.getByText(/Last sync:/i)).toHaveTextContent(/2 hours ago/i)

    await user.click(
      screen.getByRole("button", { name: /Sync Blockradar catalog/i })
    )

    // The Reason modal requires a non-empty reason before Continue activates.
    await user.type(screen.getByLabelText("Reason"), "Weekly catalog refresh")
    await user.click(screen.getByRole("button", { name: /Continue/i }))

    expect(screen.getByText(/Last sync:/i)).toHaveTextContent(/just now/i)

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/Blockradar catalog synced/i)
    expect(toasts[0].kind).toBe("info")
  })
})
