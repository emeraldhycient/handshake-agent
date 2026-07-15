import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SettingsPanel } from "./settings-panel"

const push = vi.hoisted(() => vi.fn())
const logout = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
}))
const showToast = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@/lib/query/auth", () => ({ useLogout: () => logout.current }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ showToast }) }))
vi.mock("./membership-card", () => ({
  MembershipCard: () => <div data-testid="membership" />,
}))
vi.mock("./account-section", () => ({
  AccountSection: () => <div data-testid="account" />,
}))
vi.mock("./security-section", () => ({
  SecuritySection: () => <div data-testid="security" />,
}))
vi.mock("./connected-agents-section", () => ({
  ConnectedAgentsSection: () => <div data-testid="agents" />,
}))
vi.mock("./preferences-section", () => ({
  PreferencesSection: () => <div data-testid="prefs" />,
}))
vi.mock("@/components/shared/toast", () => ({
  Toast: () => <div data-testid="toast" />,
}))

beforeEach(() => {
  push.mockClear()
  showToast.mockClear()
  logout.current = { mutateAsync: vi.fn().mockResolvedValue(undefined) }
})

describe("SettingsPanel", () => {
  it("composes the membership card and all four sections", () => {
    render(<SettingsPanel density="desktop" />)
    expect(screen.getByTestId("membership")).toBeInTheDocument()
    expect(screen.getByTestId("account")).toBeInTheDocument()
    expect(screen.getByTestId("security")).toBeInTheDocument()
    expect(screen.getByTestId("agents")).toBeInTheDocument()
    expect(screen.getByTestId("prefs")).toBeInTheDocument()
  })

  it("logs out and redirects to /login", async () => {
    render(<SettingsPanel density="desktop" />)
    await userEvent.click(screen.getByRole("button", { name: "Log out" }))
    expect(logout.current.mutateAsync).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith("/login")
  })

  it("mobile renders the app-bar back button wired to onBack", async () => {
    const onBack = vi.fn()
    render(<SettingsPanel density="mobile" onBack={onBack} />)
    await userEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(onBack).toHaveBeenCalled()
  })
})
