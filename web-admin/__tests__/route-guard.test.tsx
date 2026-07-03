/**
 * RouteGuard — the centralized per-route permission gate inside AppShell. Resolves
 * the current pathname's required menu and gates the page body against useAdminMe().
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminMe } from "@handshake-agent/contracts"

import { RouteGuard } from "@/components/admin/route-guard"

let pathname = "/admins"
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

vi.mock("@/lib/api/admin", () => ({ getMe: vi.fn() }))
import { getMe } from "@/lib/api/admin"
const mockGetMe = vi.mocked(getMe)

function adminMe(overrides: Partial<AdminMe>): AdminMe {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "ops@example.com",
    displayName: "Ops",
    role: { id: "r1", name: "ops" },
    status: "active",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
    ...overrides,
  }
}

function renderGuard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RouteGuard>
        <div>secret page body</div>
      </RouteGuard>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
  pathname = "/admins"
})

describe("RouteGuard", () => {
  it("renders the page body when the operator holds the route's menu", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: ["menu.access"] }))
    renderGuard() // /admins requires menu.access
    expect(await screen.findByText("secret page body")).toBeInTheDocument()
  })

  it("renders the page body for super_admin regardless of menus", async () => {
    mockGetMe.mockResolvedValue(
      adminMe({ role: { id: "r0", name: "super_admin" }, menus: [] })
    )
    renderGuard()
    expect(await screen.findByText("secret page body")).toBeInTheDocument()
  })

  it("shows the no-access panel (not the body) when the menu is missing", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: ["menu.transactions"] }))
    renderGuard() // /admins requires menu.access — ops here lacks it

    expect(
      await screen.findByText("You don't have access to this page")
    ).toBeInTheDocument()
    expect(screen.queryByText("secret page body")).not.toBeInTheDocument()
  })

  it("always renders an auth-only route (Dashboard) for any authenticated admin", async () => {
    pathname = "/"
    mockGetMe.mockResolvedValue(adminMe({ menus: [] }))
    renderGuard()
    expect(await screen.findByText("secret page body")).toBeInTheDocument()
  })

  it("denies on a failed profile load (can't confirm the grant)", async () => {
    mockGetMe.mockRejectedValue(new Error("boom"))
    renderGuard()
    await waitFor(() =>
      expect(
        screen.getByText("You don't have access to this page")
      ).toBeInTheDocument()
    )
    expect(screen.queryByText("secret page body")).not.toBeInTheDocument()
  })
})
