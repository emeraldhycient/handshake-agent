import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InstallButton } from "./install-button"

function mockStandalone(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("standalone") ? standalone : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

describe("InstallButton", () => {
  afterEach(() => {
    mockStandalone(false)
    vi.restoreAllMocks()
  })

  it("renders an icon button with an accessible name", () => {
    mockStandalone(false)
    render(<InstallButton />)
    expect(
      screen.getByRole("button", { name: /install app/i })
    ).toBeInTheDocument()
  })

  it("hides itself once the app is installed (standalone)", () => {
    mockStandalone(true)
    render(<InstallButton />)
    expect(
      screen.queryByRole("button", { name: /install app/i })
    ).not.toBeInTheDocument()
  })

  it("opens the install modal when clicked", async () => {
    mockStandalone(false)
    render(<InstallButton />)
    await userEvent.click(screen.getByRole("button", { name: /install app/i }))
    expect(
      screen.getByRole("dialog", { name: /install handshake agent/i })
    ).toBeInTheDocument()
  })
})
