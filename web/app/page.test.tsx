/**
 * Tests for the `/` root route (adaptive entry point).
 *
 * The default jsdom matchMedia stub (vitest.setup.ts) returns matches:false,
 * so the mobile surface is selected after effects flush.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, afterEach, vi } from "vitest"
import Home from "./page"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

describe("/ root route (adaptive entry)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the mobile chat app when matchMedia reports a non-desktop viewport", async () => {
    // Default stub: matches:false → mobile surface
    render(<Home />, { wrapper: makeWrapper() })

    // MobileShell renders the greeting message in the thread after effects
    await waitFor(() => {
      expect(screen.getByText(/I'm your Handshake Agent/i)).toBeInTheDocument()
    })
  })

  it("does not render 'Open mobile app' or 'Open desktop dashboard' manual choice links", async () => {
    render(<Home />, { wrapper: makeWrapper() })

    // Wait for effect to fire (moves out of splash state)
    await waitFor(() => {
      expect(screen.queryByText(/open mobile app/i)).toBeNull()
    })

    expect(screen.queryByText(/open desktop dashboard/i)).toBeNull()
  })

  it("renders the desktop dashboard when matchMedia reports a desktop viewport", async () => {
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

    render(<Home />, { wrapper: makeWrapper() })

    // DashboardExperience renders the desktop chat rail greeting
    await waitFor(() => {
      expect(screen.getByText(/Welcome back, Amara/i)).toBeInTheDocument()
    })
  })
})
