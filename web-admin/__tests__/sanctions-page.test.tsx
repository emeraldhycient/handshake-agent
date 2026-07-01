/**
 * SanctionsPage test (design §6.5).
 *
 * The screen is a design reproduction (no fetching). These tests assert:
 *
 *  1. The screening match cards and ongoing-monitoring rows render.
 *  2. The ongoing-monitoring switches are CONTROLLED — clicking one genuinely
 *     flips + holds its state (`aria-checked` toggles), matching the design's
 *     lightweight soft-toggle behaviour (no maker-checker gate).
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { SanctionsPage } from "@/components/admin/sanctions-page"

describe("SanctionsPage (design reproduction)", () => {
  it("renders the screening matches and ongoing-monitoring card", () => {
    render(<SanctionsPage />)

    expect(
      screen.getByRole("heading", { name: "Sanctions & screening" })
    ).toBeInTheDocument()
    expect(screen.getByText("Musa Sani")).toBeInTheDocument()
    expect(screen.getByText("Ongoing monitoring")).toBeInTheDocument()
  })

  it("flips a monitoring switch on click and holds the new state", async () => {
    const user = userEvent.setup()
    render(<SanctionsPage />)

    // "Auto-block confirmed OFAC SDN-list hits" starts OFF.
    const offToggle = screen.getByRole("switch", {
      name: "Auto-block confirmed OFAC SDN-list hits",
    })
    expect(offToggle).toHaveAttribute("aria-checked", "false")

    await user.click(offToggle)
    expect(offToggle).toHaveAttribute("aria-checked", "true")

    // "Re-screen all customers daily against updated lists" starts ON → toggles off.
    const onToggle = screen.getByRole("switch", {
      name: "Re-screen all customers daily against updated lists",
    })
    expect(onToggle).toHaveAttribute("aria-checked", "true")

    await user.click(onToggle)
    expect(onToggle).toHaveAttribute("aria-checked", "false")
  })
})
