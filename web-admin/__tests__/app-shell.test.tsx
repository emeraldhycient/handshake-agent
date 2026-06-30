/**
 * AppShell nav-gating tests.
 *
 *  1. A super_admin (menus include `menu.access` + `menu.audit`) sees the Access
 *     nav group (Admins / Roles / Sessions).
 *  2. An ops admin (menus = only `menu.audit`) does NOT see the Access group, but
 *     does see the Audit group. The Dashboard link always shows.
 *
 * The api layer is mocked — useAdminMe resolves a canned AdminMe; no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminMe } from "@handshake-agent/contracts"

import { AppShell } from "@/components/admin/app-shell"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { getMe } from "@/lib/api/admin"
const mockGetMe = vi.mocked(getMe)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function adminMe(overrides: Partial<AdminMe>): AdminMe {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
    status: "active",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
    ...overrides,
  }
}

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AppShell>
        <div>page body</div>
      </AppShell>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppShell nav gating", () => {
  it("shows the Access group for a super_admin menu set", async () => {
    mockGetMe.mockResolvedValue(
      adminMe({
        role: {
          id: "00000000-0000-0000-0000-0000000000ff",
          name: "super_admin",
        },
        menus: ["menu.access", "menu.audit"],
      })
    )

    renderShell()

    // Access group + its items appear once me resolves.
    expect(await screen.findByText("Access")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Admins" })).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Roles & permissions" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument()
    // Dashboard always shows.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()
  })

  it("hides the Access group for an ops set with only menu.audit", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: ["menu.audit"] }))

    renderShell()

    // Audit group resolves; the Access group never appears.
    expect(await screen.findByText("Audit")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: "Admins" })
      ).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole("link", { name: "Roles & permissions" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Sessions" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Access")).not.toBeInTheDocument()
  })
})
