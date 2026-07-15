import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SettingsHeader } from "./settings-header"

describe("SettingsHeader", () => {
  it("desktop: renders the brand chip, title and Ask the agent", async () => {
    const onAsk = vi.fn()
    render(<SettingsHeader density="desktop" onAsk={onAsk} />)
    expect(
      screen.getByRole("heading", { name: "Settings" })
    ).toBeInTheDocument()
    expect(screen.getByText("Handshake · Account")).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: /ask the agent/i })
    )
    expect(onAsk).toHaveBeenCalled()
  })

  it("mobile: renders a back button wired to onBack plus an Ask button", async () => {
    const onBack = vi.fn()
    render(<SettingsHeader density="mobile" onBack={onBack} />)
    await userEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(onBack).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument()
  })
})
