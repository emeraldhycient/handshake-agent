/**
 * AppShell nav-gating tests (design chrome §4.1 — "Platform" group).
 *
 *  1. A super_admin (menus include `menu.access` + `menu.audit`) sees the
 *     access-scoped items (Admins & roles / Roles / Sessions) and Audit log.
 *  2. An ops admin (menus = only `menu.audit`) does NOT see the menu.access
 *     items, but DOES see Audit log. The Dashboard link always shows.
 *
 * The api layer is mocked — useAdminMe resolves a canned AdminMe; no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

// Stub the enroll dialog so the shell's affordance is tested in isolation (the
// real dialog fires a POST on open).
vi.mock("@/components/admin/mfa-enroll-dialog", () => ({
  MfaEnrollDialog: ({ open }: { open: boolean }) =>
    open ? <div>mfa-enroll-dialog-open</div> : null,
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
  it("shows the access-scoped items + Audit for a super_admin menu set", async () => {
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

    // The menu.access items appear once me resolves.
    expect(
      await screen.findByRole("link", { name: "Admins & roles" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Roles" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument()
    // Audit log (menu.audit) + Dashboard (always) also show.
    expect(screen.getByRole("link", { name: "Audit log" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()
  })

  it("hides the menu.access items but shows Audit for an ops set with only menu.audit", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: ["menu.audit"] }))

    renderShell()

    // Audit log resolves (menu.audit granted); Dashboard always shows.
    expect(
      await screen.findByRole("link", { name: "Audit log" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()

    // The menu.access items never appear.
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: "Admins & roles" })
      ).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole("link", { name: "Roles" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Sessions" })
    ).not.toBeInTheDocument()
  })
})

describe("AppShell MFA enrollment affordance", () => {
  it("shows a Set up MFA control when not enrolled and opens the enroll dialog", async () => {
    mockGetMe.mockResolvedValue(adminMe({ mfaEnabled: false }))

    renderShell()

    const button = await screen.findByRole("button", { name: /set up mfa/i })
    expect(screen.queryByText("mfa-enroll-dialog-open")).not.toBeInTheDocument()

    await userEvent.click(button)

    expect(screen.getByText("mfa-enroll-dialog-open")).toBeInTheDocument()
  })

  it("hides the Set up MFA control once MFA is enrolled", async () => {
    mockGetMe.mockResolvedValue(adminMe({ mfaEnabled: true }))

    renderShell()

    // Sign out is always present once me resolves — anchor on it, then assert
    // the MFA control is absent.
    expect(
      await screen.findByRole("button", { name: "Sign out" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /set up mfa/i })
    ).not.toBeInTheDocument()
  })
})
