import { describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
      limits: null,
    },
  }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("@/lib/query/hooks", () => ({
  useConfig: () => ({ data: { fiats: [{ code: "NGN", symbol: "₦" }] } }),
}))

// LanguageSelector needs the translation context; stub it here.
vi.mock("@/components/shared/language-selector", () => ({
  LanguageSelector: () => <div data-testid="language-selector" />,
}))

import { SettingsPanel } from "./settings-panel"

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

describe("SettingsPanel", () => {
  it("renders the profile name and the language selector", () => {
    render(<SettingsPanel />, { wrapper })
    expect(screen.getByText("Ada Tester")).toBeInTheDocument()
    expect(screen.getByTestId("language-selector")).toBeInTheDocument()
  })

  it("renders a logout control", () => {
    render(<SettingsPanel />, { wrapper })
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument()
  })
})
