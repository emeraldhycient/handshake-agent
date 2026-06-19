import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { SettingsPage } from "./settings-page"

describe("SettingsPage", () => {
  it("renders the page headline", () => {
    render(<SettingsPage />)
    expect(screen.getByText(/Settings/i)).toBeInTheDocument()
  })

  it("renders the profile card", () => {
    render(<SettingsPage />)
    expect(screen.getByText(/Amara Okeke/i)).toBeInTheDocument()
    expect(screen.getByText(/\+234 802/)).toBeInTheDocument()
    expect(screen.getByText(/Verified · Tier 3/i)).toBeInTheDocument()
  })

  it("renders the Security section with Transaction PIN row", () => {
    render(<SettingsPage />)
    expect(screen.getByText(/Security/i)).toBeInTheDocument()
    expect(screen.getByText(/Transaction PIN/i)).toBeInTheDocument()
  })

  it("renders Face ID toggle (ui/switch)", () => {
    render(<SettingsPage />)
    expect(screen.getByRole("switch", { name: /Face ID/i })).toBeInTheDocument()
  })

  it("toggles Face ID switch on click", async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    const toggle = screen.getByRole("switch", { name: /Face ID/i })
    // Initial state — on (checked by default)
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
  })

  it("renders Language section with 5 pills", () => {
    render(<SettingsPage />)
    expect(screen.getByText(/Language/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /English/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Pidgin/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Hausa/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Yoruba/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Igbo/i })).toBeInTheDocument()
  })

  it("selects a language pill on click", async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    const pidginBtn = screen.getByRole("button", { name: /Pidgin/i })
    await user.click(pidginBtn)
    // After click, data-active should be true on Pidgin
    expect(pidginBtn).toHaveAttribute("data-active", "true")
  })

  it("renders the Tier-3 daily limit", () => {
    render(<SettingsPage />)
    expect(screen.getByText(/₦5,000,000/)).toBeInTheDocument()
    expect(screen.getByText(/Daily transfer limit/i)).toBeInTheDocument()
  })
})
