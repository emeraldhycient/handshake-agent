import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const routerPush = vi.hoisted(() => vi.fn())
const logoutMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock("@/lib/query/auth", () => ({
  useProfile: () => ({
    isLoading: false,
    isError: false,
    data: {
      email: "user@example.com",
      fullName: "Ada Tester",
      phone: null,
      kycStatus: "verified",
      kycTier: "tier_1",
      fiatCurrency: "NGN",
      limits: { perTxFiatMax: 50000, dailyFiatMax: 50000, dailyTxCountMax: 5 },
    },
  }),
  useLogout: () => logoutMutation.current,
}))

vi.mock("@/lib/query/hooks", () => ({
  useConfig: () => ({
    data: {
      fiats: [
        {
          code: "NGN",
          displayName: "Nigerian Naira",
          symbol: "₦",
          decimals: 2,
        },
      ],
    },
  }),
}))

// Sections have their own specs — the orchestrator test asserts composition.
vi.mock("./profile-section", () => ({
  ProfileSection: () => <div data-testid="profile-section" />,
}))
vi.mock("./VerificationSection", () => ({
  VerificationSection: () => <div data-testid="verification-section" />,
}))
vi.mock("./security-section", () => ({
  SecuritySection: () => <div data-testid="security-section" />,
}))
vi.mock("./mcp-section", () => ({
  McpSection: () => <div data-testid="mcp-section" />,
}))

// LanguageSelector needs the translation context; stub it here.
vi.mock("@/components/shared/language-selector", () => ({
  LanguageSelector: () => <div data-testid="language-selector" />,
}))

import { SettingsPanel } from "./settings-panel"

describe("SettingsPanel (orchestrator)", () => {
  beforeEach(() => {
    routerPush.mockReset()
    logoutMutation.current = {
      mutate: vi.fn((_: unknown, opts?: { onSettled?: () => void }) =>
        opts?.onSettled?.()
      ),
      isPending: false,
    }
  })

  it("composes the profile, security, MCP and language sections", () => {
    render(<SettingsPanel />)
    expect(screen.getByTestId("profile-section")).toBeInTheDocument()
    expect(screen.getByTestId("verification-section")).toBeInTheDocument()
    expect(screen.getByTestId("security-section")).toBeInTheDocument()
    expect(screen.getByTestId("mcp-section")).toBeInTheDocument()
    expect(screen.getByTestId("language-selector")).toBeInTheDocument()
  })

  it("renders the real daily limit from the profile", () => {
    render(<SettingsPanel />)
    expect(screen.getByText("₦50,000")).toBeInTheDocument()
  })

  it("logs out and redirects to /login", async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)

    await user.click(screen.getByRole("button", { name: /log out/i }))

    expect(logoutMutation.current.mutate).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith("/login")
  })
})
