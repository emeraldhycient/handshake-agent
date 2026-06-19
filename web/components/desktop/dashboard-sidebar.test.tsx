import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DashboardSidebar } from "./dashboard-sidebar"
import type { DashboardPage } from "@/lib/schemas"

describe("DashboardSidebar", () => {
  it("renders all 5 nav items", () => {
    render(<DashboardSidebar active="overview" onNavigate={() => {}} />)
    expect(
      screen.getByRole("button", { name: /overview/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /wallet/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /activity/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /tickets/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /settings/i })
    ).toBeInTheDocument()
  })

  it("marks the active item with data-active", () => {
    render(<DashboardSidebar active="wallet" onNavigate={() => {}} />)
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
    render(<DashboardSidebar active="overview" onNavigate={onNavigate} />)
    await user.click(screen.getByRole("button", { name: /activity/i }))
    expect(onNavigate).toHaveBeenCalledWith("activity" satisfies DashboardPage)
  })

  it("renders the verified-account badge", () => {
    render(<DashboardSidebar active="overview" onNavigate={() => {}} />)
    expect(screen.getByText(/verified account/i)).toBeInTheDocument()
  })

  it("renders the user profile name", () => {
    render(<DashboardSidebar active="overview" onNavigate={() => {}} />)
    expect(screen.getByText("Amara Okeke")).toBeInTheDocument()
  })
})
