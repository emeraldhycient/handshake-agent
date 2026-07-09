import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Children have their own specs — assert composition + the dead-toggle removal.
vi.mock("./change-pin-dialog", () => ({
  ChangePinDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="change-pin-dialog" /> : null,
}))
vi.mock("./sessions-list", () => ({
  SessionsList: () => <div data-testid="sessions-list" />,
}))

import { SecuritySection } from "./security-section"

describe("SecuritySection", () => {
  it("opens the change-PIN dialog from the Change button", async () => {
    const user = userEvent.setup()
    render(<SecuritySection />)

    expect(screen.queryByTestId("change-pin-dialog")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /change/i }))
    expect(screen.getByTestId("change-pin-dialog")).toBeInTheDocument()
  })

  it("renders the sessions list", () => {
    render(<SecuritySection />)
    expect(screen.getByTestId("sessions-list")).toBeInTheDocument()
  })

  it("has no placeholder Face ID toggle (§3.6 — no fake interactivity)", () => {
    render(<SecuritySection />)
    expect(screen.queryByText(/face id/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })
})
