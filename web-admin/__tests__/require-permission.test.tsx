/**
 * RequirePermission tests.
 *
 *  1. Renders the page body when the `web_page` id IS in adminMe.pages.
 *  2. Blocks the body (renders the no-access panel) when the id is absent.
 *
 * The api layer is mocked — useAdminMe resolves a canned AdminMe; no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminMe } from "@handshake-agent/contracts"

import { RequirePermission } from "@/components/admin/require-permission"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({ getMe: vi.fn() }))

import { getMe } from "@/lib/api/admin"
const mockGetMe = vi.mocked(getMe)

function adminMe(pages: string[]): AdminMe {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
    status: "active",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages,
  }
}

function renderGate(page: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RequirePermission page={page}>
        <div>secret page body</div>
      </RequirePermission>
    </QueryClientProvider>
  )
}

beforeEach(() => mockGetMe.mockReset())

describe("RequirePermission", () => {
  it("renders the body when the web_page is granted", async () => {
    mockGetMe.mockResolvedValue(adminMe(["/admin/admins"]))
    renderGate("/admin/admins")
    expect(await screen.findByText("secret page body")).toBeInTheDocument()
  })

  it("blocks the body when the web_page is absent", async () => {
    mockGetMe.mockResolvedValue(adminMe(["/admin/audit"]))
    renderGate("/admin/admins")

    // No-access panel appears; the body never renders.
    expect(
      await screen.findByText(/don't have access to this page/i)
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("secret page body")).not.toBeInTheDocument()
    })
  })
})
