/**
 * UsersPage render test — WIRED to real data (Phase 6a).
 *
 * The page now renders `useEndUsers(query)` (GET /admin/users) instead of a
 * module-level 28-user mock. The api client (`@/lib/api/users`) is mocked (like
 * kyc-submission.test.tsx / metrics-dashboard.test.tsx) so no server is needed.
 *
 * Asserted branches:
 *  - loading → data: skeletons give way to a real user row derived from the mocked
 *    `AdminEndUserListResponse` (name derived from the email local-part, since the
 *    list contract carries no name field; simSwapFlagged → the SIM-SWAP risk badge).
 *  - empty: an empty `items[]` renders the design's "No users match these filters".
 *  - error: a rejected fetch renders the inline retry affordance.
 *
 * `next/navigation` is stubbed because a row click calls `useRouter().push`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminEndUserListResponse } from "@handshake-agent/contracts"

import { UsersPage } from "@/components/admin/users-page"
import { defaultToastStore } from "@/lib/store/toast-store"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/lib/api/users", () => ({
  listEndUsers: vi.fn(),
}))

import { listEndUsers } from "@/lib/api/users"

const mockListEndUsers = vi.mocked(listEndUsers)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESPONSE: AdminEndUserListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "amara.okeke@example.com",
      status: "active",
      kycStatus: "pending",
      kycTier: "tier_3",
      simSwapFlagged: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "ngozi.balogun@example.com",
      status: "active",
      kycStatus: "verified",
      kycTier: "tier_1",
      simSwapFlagged: true,
      createdAt: new Date().toISOString(),
    },
  ],
  nextCursor: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockListEndUsers.mockReset()
})

describe("UsersPage (wired)", () => {
  it("renders the header and the customer table columns", async () => {
    mockListEndUsers.mockResolvedValue(RESPONSE)
    renderPage()

    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument()
    // 7-column table headers.
    expect(screen.getByText("Customer")).toBeInTheDocument()
    expect(screen.getByText("KYC")).toBeInTheDocument()
    expect(screen.getByText("Risk")).toBeInTheDocument()
    expect(screen.getByText("Last active")).toBeInTheDocument()

    // Rows resolve from the mocked response (loading → data).
    await screen.findByText("Amara Okeke")
  })

  it("maps real list items to rows, deriving names and the SIM-swap badge", async () => {
    mockListEndUsers.mockResolvedValue(RESPONSE)
    renderPage()

    // Name derived from the email local-part (list contract has no name field).
    expect(await screen.findByText("Amara Okeke")).toBeInTheDocument()
    expect(screen.getByText("Ngozi Balogun")).toBeInTheDocument()
    expect(screen.getByText("amara.okeke@example.com")).toBeInTheDocument()

    // Ngozi is simSwapFlagged → the SIM-SWAP risk badge; Amara is not.
    expect(screen.getAllByText("SIM-SWAP")).toHaveLength(1)
  })

  it("renders the empty state when the list is empty", async () => {
    mockListEndUsers.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    expect(
      await screen.findByText("No users match these filters")
    ).toBeInTheDocument()
  })

  it("renders an inline retry affordance when the fetch fails", async () => {
    mockListEndUsers.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(await screen.findByText("Couldn't load users")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("passes the tier filter to the server as kycTier", async () => {
    const user = userEvent.setup()
    mockListEndUsers.mockResolvedValue(RESPONSE)
    renderPage()

    await screen.findByText("Amara Okeke")
    await user.selectOptions(screen.getByLabelText("Filter by tier"), "tier_2")

    await waitFor(() =>
      expect(mockListEndUsers).toHaveBeenCalledWith(
        expect.objectContaining({ kycTier: "tier_2" })
      )
    )
  })

  it("toasts a CSV export over the shown set from the header button", async () => {
    const user = userEvent.setup()
    mockListEndUsers.mockResolvedValue(RESPONSE)
    renderPage()

    await screen.findByText("Amara Okeke")
    await user.click(screen.getByRole("button", { name: "Export CSV" }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe("Exporting 2 users to CSV…")
    expect(toasts[0].kind).toBe("info")
  })
})
