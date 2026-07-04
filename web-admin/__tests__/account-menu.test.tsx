/**
 * AccountMenu tests — the topbar account pill is an HONEST read-only role display
 * (§3.4): it shows the signed-in email + the operator's real role and offers a
 * Sign out. The former "view as role" impersonation SWITCHER is removed — there are
 * no per-role menu items and no impersonation affordance. Pure component: no api
 * mocks, just the props the shell passes down.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AccountMenu } from "@/components/admin/account-menu"

function renderMenu(overrides: Partial<Parameters<typeof AccountMenu>[0]> = {}) {
  const onSignOut = vi.fn()
  render(
    <AccountMenu
      email="admin@example.com"
      realRoleLabel="super_admin"
      onSignOut={onSignOut}
      {...overrides}
    />
  )
  return { onSignOut }
}

describe("AccountMenu (honest role, no view-as)", () => {
  it("shows the signed-in email and the operator's real role", async () => {
    renderMenu()

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }))

    // Email appears on both the pill and inside the open menu.
    expect(screen.getAllByText("admin@example.com").length).toBeGreaterThan(0)
    // The honest read-only real-role display.
    expect(screen.getAllByText("super_admin").length).toBeGreaterThan(0)
  })

  it("offers Sign out and calls onSignOut when selected", async () => {
    const { onSignOut } = renderMenu()

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it("renders NO view-as role switcher (no section, no per-role items)", async () => {
    renderMenu()

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }))

    expect(screen.queryByText(/view as role/i)).not.toBeInTheDocument()
    for (const role of ["Operations", "Compliance", "Finance", "Support"]) {
      expect(
        screen.queryByRole("menuitem", { name: role })
      ).not.toBeInTheDocument()
    }
    // The only actionable items are the self-service "My account" link and
    // "Sign out" — no per-role impersonation items.
    expect(screen.getAllByRole("menuitem")).toHaveLength(2)
    expect(
      screen.getByRole("menuitem", { name: "My account" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: "Sign out" })
    ).toBeInTheDocument()
  })
})
