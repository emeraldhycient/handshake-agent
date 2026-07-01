/**
 * CapabilitiesPage test (design §6.25 reproduction).
 *
 * The capability kill-switch is dual-control: clicking a switch never flips it
 * directly — it opens the shared MakerCheckerModal. Approving the change ("Submit
 * for approval") inverts the pending capability's `on` flag in local state, so the
 * switch (`aria-checked`) + ENABLED/DISABLED pill visibly change and a toast fires.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { CapabilitiesPage } from "@/components/admin/capabilities-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("CapabilitiesPage (dual-control kill-switch)", () => {
  it("renders the switchboard rows with their status pills", () => {
    render(<CapabilitiesPage />)

    expect(
      screen.getByRole("heading", { name: "Capabilities / service registry" })
    ).toBeInTheDocument()

    // The design's seed rows render as accessible switches.
    expect(screen.getByRole("switch", { name: "crypto.buy" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(
      screen.getByRole("switch", { name: "ticketing.tix" })
    ).toHaveAttribute("aria-checked", "false")
  })

  it("does not flip the switch on click — it opens the maker-checker modal", async () => {
    const user = userEvent.setup()
    render(<CapabilitiesPage />)

    const toggle = screen.getByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)

    // Still enabled — the click only opened dual-control approval.
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByRole("dialog", { name: /Disable crypto.buy/ })
    ).toBeInTheDocument()
  })

  it("flips the switch + pill and toasts after the modal is approved", async () => {
    const user = userEvent.setup()
    render(<CapabilitiesPage />)

    const toggle = screen.getByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)

    const dialog = screen.getByRole("dialog", { name: /Disable crypto.buy/ })
    await user.click(
      within(dialog).getByRole("button", { name: "Submit for approval" })
    )

    // The switch is now off and the pill reads DISABLED.
    const flipped = screen.getByRole("switch", { name: "crypto.buy" })
    expect(flipped).toHaveAttribute("aria-checked", "false")
    // The DISABLED pill lives in the same row card as the toggle.
    const row = flipped.parentElement!
    expect(within(row).getByText("DISABLED")).toBeInTheDocument()

    // A feedback toast fired and the modal closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "crypto.buy disabled" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("re-enables a disabled capability after approval", async () => {
    const user = userEvent.setup()
    render(<CapabilitiesPage />)

    const toggle = screen.getByRole("switch", { name: "ticketing.tix" })
    await user.click(toggle)

    const dialog = screen.getByRole("dialog", { name: /Enable ticketing.tix/ })
    await user.click(
      within(dialog).getByRole("button", { name: "Submit for approval" })
    )

    expect(
      screen.getByRole("switch", { name: "ticketing.tix" })
    ).toHaveAttribute("aria-checked", "true")
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "ticketing.tix enabled" })
    )
  })
})
