import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach } from "vitest"
import { SettingsPage } from "./settings-page"
import { useProfile } from "@/lib/query/auth"
import type { ProfileResponse } from "@handshake-agent/contracts"

// Mock next/navigation so useRouter() works in tests.
const mockRouterPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// useProfile is mocked so we can drive the four branches directly; useConfig
// (for the fiat symbol) still resolves through the real mock gateway.
vi.mock("@/lib/query/auth", () => ({
  useProfile: vi.fn(),
  useLogout: vi.fn(() => ({
    mutate: vi.fn((_: unknown, opts?: { onSettled?: () => void }) => {
      opts?.onSettled?.()
    }),
    isPending: false,
  })),
}))
const mockedUseProfile = vi.mocked(useProfile)

const profileData: ProfileResponse = {
  email: "amara@example.com",
  fullName: "Amara Okeke",
  phone: "+2348011112222",
  kycStatus: "verified",
  kycTier: "tier_1",
  fiatCurrency: "NGN",
  limits: { perTxFiatMax: 50000, dailyFiatMax: 200000, dailyTxCountMax: 10 },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asQuery = (v: unknown) => v as any

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return wrapper
}

describe("SettingsPage", () => {
  afterEach(() => vi.restoreAllMocks())

  it("renders a loading skeleton while the profile loads", () => {
    mockedUseProfile.mockReturnValue(
      asQuery({ isLoading: true, isError: false, data: undefined })
    )
    render(<SettingsPage />, { wrapper: makeWrapper() })
    expect(screen.getByText(/Settings/i)).toBeInTheDocument()
    expect(screen.queryByText(/Amara Okeke/)).not.toBeInTheDocument()
  })

  it("renders an error state when the profile fails", () => {
    mockedUseProfile.mockReturnValue(
      asQuery({ isLoading: false, isError: true, data: undefined })
    )
    render(<SettingsPage />, { wrapper: makeWrapper() })
    expect(screen.getByText(/Could not load your profile/i)).toBeInTheDocument()
  })

  it("renders name, phone, tier badge, and the real daily limit", async () => {
    mockedUseProfile.mockReturnValue(
      asQuery({ isLoading: false, isError: false, data: profileData })
    )
    render(<SettingsPage />, { wrapper: makeWrapper() })
    expect(screen.getByText("Amara Okeke")).toBeInTheDocument()
    expect(screen.getByText("+2348011112222")).toBeInTheDocument()
    expect(screen.getByText(/Verified · Tier 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Daily transfer limit/i)).toBeInTheDocument()
    // Limit is formatted with the ₦ symbol once /config resolves.
    await waitFor(() =>
      expect(screen.getByText(/₦200,000/)).toBeInTheDocument()
    )
  })

  it("falls back to the email when no name is present", () => {
    mockedUseProfile.mockReturnValue(
      asQuery({
        isLoading: false,
        isError: false,
        data: { ...profileData, fullName: null, phone: null },
      })
    )
    render(<SettingsPage />, { wrapper: makeWrapper() })
    expect(screen.getByText("amara@example.com")).toBeInTheDocument()
  })

  it("renders the Security + Language sections (UI-only)", () => {
    mockedUseProfile.mockReturnValue(
      asQuery({ isLoading: false, isError: false, data: profileData })
    )
    render(<SettingsPage />, { wrapper: makeWrapper() })
    expect(screen.getByText(/Transaction PIN/i)).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /Face ID/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /English/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Igbo/i })).toBeInTheDocument()
  })

  it("toggles the Face ID switch and selects a language pill", async () => {
    mockedUseProfile.mockReturnValue(
      asQuery({ isLoading: false, isError: false, data: profileData })
    )
    const user = userEvent.setup()
    render(<SettingsPage />, { wrapper: makeWrapper() })

    const toggle = screen.getByRole("switch", { name: /Face ID/i })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(toggle).not.toBeChecked()

    const pidgin = screen.getByRole("button", { name: /Pidgin/i })
    await user.click(pidgin)
    expect(pidgin).toHaveAttribute("data-active", "true")
  })

  it("renders a Log out button", () => {
    mockedUseProfile.mockReturnValue(
      asQuery({ isLoading: false, isError: false, data: profileData })
    )
    render(<SettingsPage />, { wrapper: makeWrapper() })
    expect(screen.getByRole("button", { name: /Log out/i })).toBeInTheDocument()
  })

  it("calls the logout mutation and redirects to /login on click", async () => {
    mockedUseProfile.mockReturnValue(
      asQuery({ isLoading: false, isError: false, data: profileData })
    )
    const user = userEvent.setup()
    render(<SettingsPage />, { wrapper: makeWrapper() })

    await user.click(screen.getByRole("button", { name: /Log out/i }))
    // The mock mutate() calls onSettled() synchronously, which pushes /login.
    expect(mockRouterPush).toHaveBeenCalledWith("/login")
  })
})
