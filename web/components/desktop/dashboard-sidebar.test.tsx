import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach } from "vitest"
import type { PublicConfigResponse } from "@handshake-agent/contracts"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import { gateway } from "@/lib/api/gateway"
import { defaultAuthStore } from "@/lib/store/auth-store"
import { DashboardSidebar } from "./dashboard-sidebar"
import type { DashboardPage } from "@/lib/schemas"

const baseConfig: Omit<PublicConfigResponse, "capabilities"> = {
  fiats: [
    { code: "NGN", displayName: "Nigerian Naira", symbol: "₦", decimals: 2 },
  ],
  assets: [
    {
      symbol: "USDT",
      displayName: "Tether USD",
      decimals: 6,
      networks: ["tron"],
    },
  ],
  networks: [{ id: "tron", displayName: "TRON (TRC-20)" }],
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return wrapper
}

describe("DashboardSidebar", () => {
  afterEach(() => vi.restoreAllMocks())

  it("renders the core nav items and hides Tickets when ticketing is off", () => {
    render(<DashboardSidebar active="overview" onNavigate={() => {}} />, {
      wrapper: makeWrapper(),
    })
    expect(
      screen.getByRole("button", { name: /overview/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /wallet/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /activity/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /settings/i })
    ).toBeInTheDocument()
    // Tickets is hidden: no ticketing capability in the default config.
    expect(
      screen.queryByRole("button", { name: /tickets/i })
    ).not.toBeInTheDocument()
  })

  it("shows Tickets when the ticketing capability is enabled", async () => {
    vi.spyOn(gateway, "getConfig").mockResolvedValue({
      ...baseConfig,
      capabilities: { ticketing: true },
    })
    render(<DashboardSidebar active="overview" onNavigate={() => {}} />, {
      wrapper: makeWrapper(),
    })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /tickets/i })
      ).toBeInTheDocument()
    )
  })

  it("marks the active item with data-active", () => {
    render(<DashboardSidebar active="wallet" onNavigate={() => {}} />, {
      wrapper: makeWrapper(),
    })
    const walletBtn = screen.getByRole("button", { name: /wallet/i })
    expect(walletBtn).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("button", { name: /overview/i })).toHaveAttribute(
      "data-active",
      "false"
    )
  })

  it("calls onNavigate with the correct page when a nav item is clicked", async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<DashboardSidebar active="overview" onNavigate={onNavigate} />, {
      wrapper: makeWrapper(),
    })
    await user.click(screen.getByRole("button", { name: /activity/i }))
    expect(onNavigate).toHaveBeenCalledWith("activity" satisfies DashboardPage)
  })

  it("renders the verified-account badge", () => {
    render(<DashboardSidebar active="overview" onNavigate={() => {}} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.getByText(/verified account/i)).toBeInTheDocument()
  })

  it("shows the full name when the auth store has a KYC-profiled user", () => {
    const meFixture: MeResponse = {
      userId: "11111111-1111-1111-1111-111111111111",
      email: "amara@example.com",
      kycStatus: "verified",
      kycTier: "tier_1",
      hasPin: true,
      firstName: "Amara",
      lastName: "Okeke",
    }
    defaultAuthStore.getState().setUser(meFixture)

    render(<DashboardSidebar active="overview" onNavigate={() => {}} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.getByText("Amara Okeke")).toBeInTheDocument()
    // Email shown as secondary line when name is present
    expect(screen.getByText("amara@example.com")).toBeInTheDocument()

    defaultAuthStore.getState().clear()
  })

  it("falls back to the email local-part when no name is on the KYC profile", () => {
    const meFixture: MeResponse = {
      userId: "11111111-1111-1111-1111-111111111111",
      email: "amara@example.com",
      kycStatus: "not_started",
      kycTier: "unverified",
      hasPin: false,
      firstName: null,
      lastName: null,
    }
    defaultAuthStore.getState().setUser(meFixture)

    render(<DashboardSidebar active="overview" onNavigate={() => {}} />, {
      wrapper: makeWrapper(),
    })
    // The email's local-part "amara" is used when no full name is set.
    expect(screen.getByText("amara")).toBeInTheDocument()

    defaultAuthStore.getState().clear()
  })
})
