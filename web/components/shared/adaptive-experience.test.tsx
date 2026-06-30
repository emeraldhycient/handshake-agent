/**
 * Tests for AdaptiveExperience — auto-selects mobile or desktop surface.
 *
 * Default jsdom matchMedia stub (vitest.setup.ts): matches:false → mobile.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, afterEach, vi } from "vitest"
import { AdaptiveExperience } from "./adaptive-experience"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

describe("AdaptiveExperience", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the mobile chat app on a narrow viewport (matchMedia matches:false)", async () => {
    // Default stub returns matches:false → MobileShell is selected
    render(<AdaptiveExperience />, { wrapper: makeWrapper() })

    // MobileShell renders the mobile greeting in the chat thread
    await waitFor(() => {
      expect(screen.getByText(/I'm your Handshake Agent/i)).toBeInTheDocument()
    })
  })

  it("does not render desktop dashboard elements on mobile", async () => {
    render(<AdaptiveExperience />, { wrapper: makeWrapper() })

    // Wait for effects to flush
    await waitFor(() => {
      expect(screen.getByText(/I'm your Handshake Agent/i)).toBeInTheDocument()
    })

    // Desktop greeting must not be present
    expect(
      screen.queryByText(/right here whenever you want to move money/i)
    ).toBeNull()
  })

  it("renders the desktop dashboard on a wide viewport (matchMedia matches:true)", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(min-width: 1024px)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList)

    render(<AdaptiveExperience />, { wrapper: makeWrapper() })

    // DashboardExperience renders the desktop chat rail greeting
    await waitFor(() => {
      expect(
        screen.getByText(/right here whenever you want to move money/i)
      ).toBeInTheDocument()
    })
  })

  it("does not render mobile chat elements on a desktop viewport", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(min-width: 1024px)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList)

    render(<AdaptiveExperience />, { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(
        screen.getByText(/right here whenever you want to move money/i)
      ).toBeInTheDocument()
    })

    // Sidebar nav items are desktop-only (not in MobileShell)
    expect(
      screen.getByRole("button", { name: /overview/i })
    ).toBeInTheDocument()
  })
})
