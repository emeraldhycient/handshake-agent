import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import Page from "./page"

describe("Launcher page (/)", () => {
  it('shows "Handshake Agent" heading', () => {
    render(<Page />)
    expect(
      screen.getByRole("heading", { name: /handshake agent/i })
    ).toBeInTheDocument()
  })

  it("shows the tagline", () => {
    render(<Page />)
    expect(
      screen.getByText(/chat-native crypto & payments/i)
    ).toBeInTheDocument()
  })

  it('has a link to /app labelled "Open mobile app"', () => {
    render(<Page />)
    const link = screen.getByRole("link", { name: /open mobile app/i })
    expect(link).toBeInTheDocument()
    expect(link.getAttribute("href")).toBe("/app")
  })

  it('has a link to /dashboard labelled "Open desktop dashboard"', () => {
    render(<Page />)
    const link = screen.getByRole("link", { name: /open desktop dashboard/i })
    expect(link).toBeInTheDocument()
    expect(link.getAttribute("href")).toBe("/dashboard")
  })

  it('has a link to /onboarding labelled "Start onboarding"', () => {
    render(<Page />)
    const link = screen.getByRole("link", { name: /start onboarding/i })
    expect(link).toBeInTheDocument()
    expect(link.getAttribute("href")).toBe("/onboarding")
  })

  it("does not show the scaffold dark-mode toggle text", () => {
    render(<Page />)
    expect(screen.queryByText(/press d to toggle dark mode/i)).toBeNull()
    expect(screen.queryByText(/project ready/i)).toBeNull()
  })
})
