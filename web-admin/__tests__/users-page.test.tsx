/**
 * UsersPage render test — WIRED to real data (Phase 6a).
 *
 * The page now renders `useEndUsers(query)` (GET /admin/users) instead of a
 * module-level 28-user mock. The api client (`@/lib/api/users`) is mocked (like
 * kyc-submission.test.tsx / metrics-dashboard.test.tsx) so no server is needed.
 *
 * Asserted branches:
 *  - loading → data: skeletons give way to a real user row derived from the mocked
 *    `AdminEndUserListResponse` (server-provided displayName; simSwapFlagged /
 *    sanctionsFlagged → the SIM-SWAP / SANCTIONS risk badges; the balance summary
 *    and real lastActiveAt render; the header shows the server `total`).
 *  - empty: an empty `items[]` renders the design's "No users match these filters".
 *  - error: a rejected fetch renders the inline retry affordance.
 *  - KYC-status filter maps to the server-side `kycStatus` param.
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
  exportEndUsers: vi.fn(),
}))
vi.mock("@/lib/download", () => ({
  downloadFile: vi.fn(),
  exportFilename: (subject: string) => `${subject}-export.csv`,
}))

import { listEndUsers, exportEndUsers } from "@/lib/api/users"
import { downloadFile } from "@/lib/download"

const mockListEndUsers = vi.mocked(listEndUsers)
const mockExportEndUsers = vi.mocked(exportEndUsers)
const mockDownloadFile = vi.mocked(downloadFile)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESPONSE: AdminEndUserListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "amara.okeke@example.com",
      displayName: "Amara Okeke",
      status: "active",
      kycStatus: "pending",
      kycTier: "tier_3",
      simSwapFlagged: false,
      sanctionsFlagged: true,
      balances: [{ asset: "USDT", amount: "1200.50" }],
      lastActiveAt: new Date(Date.now() - 3_600_000).toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "ngozi.balogun@example.com",
      displayName: "Ngozi Balogun",
      status: "active",
      kycStatus: "verified",
      kycTier: "tier_1",
      simSwapFlagged: true,
      sanctionsFlagged: false,
      balances: [],
      lastActiveAt: null,
      createdAt: new Date().toISOString(),
    },
  ],
  nextCursor: null,
  total: 128,
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

  it("maps real list items to rows, using displayName and both risk badges", async () => {
    mockListEndUsers.mockResolvedValue(RESPONSE)
    renderPage()

    // Server-provided displayName (no longer derived from the email local-part).
    expect(await screen.findByText("Amara Okeke")).toBeInTheDocument()
    expect(screen.getByText("Ngozi Balogun")).toBeInTheDocument()
    expect(screen.getByText("amara.okeke@example.com")).toBeInTheDocument()

    // Ngozi is simSwapFlagged; Amara is sanctionsFlagged — each renders once.
    expect(screen.getAllByText("SIM-SWAP")).toHaveLength(1)
    expect(screen.getAllByText("SANCTIONS")).toHaveLength(1)
  })

  it("renders the balance summary, real last-active, and the server total", async () => {
    mockListEndUsers.mockResolvedValue(RESPONSE)
    renderPage()

    // Balance summary from the per-asset aggregate (native crypto amount).
    expect(await screen.findByText("1,200.5 USDT")).toBeInTheDocument()
    // A real lastActiveAt (~1h ago) renders a relative label, not registration.
    expect(screen.getByText("1h ago")).toBeInTheDocument()
    // The header surfaces the server-provided total.
    expect(screen.getByText("128")).toBeInTheDocument()
  })

  it("renders the empty state when the list is empty", async () => {
    mockListEndUsers.mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    })
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

  it("maps the KYC-status filter to the server-side kycStatus param", async () => {
    const user = userEvent.setup()
    mockListEndUsers.mockResolvedValue(RESPONSE)
    renderPage()

    await screen.findByText("Amara Okeke")
    // "Needs info" bucket → the contract's `pending_review` status.
    await user.selectOptions(
      screen.getByLabelText("Filter by KYC status"),
      "needs_info"
    )

    await waitFor(() =>
      expect(mockListEndUsers).toHaveBeenCalledWith(
        expect.objectContaining({ kycStatus: "pending_review" })
      )
    )
  })

  it("downloads a CSV export over the shown set from the header button", async () => {
    const user = userEvent.setup()
    mockListEndUsers.mockResolvedValue(RESPONSE)
    mockExportEndUsers.mockResolvedValue(new Blob(["id,email\n"]))
    renderPage()

    await screen.findByText("Amara Okeke")
    await user.click(screen.getByRole("button", { name: "Export CSV" }))

    // No selection → export ALL matching filters (includedIds undefined).
    await waitFor(() => expect(mockExportEndUsers).toHaveBeenCalledTimes(1))
    expect(mockExportEndUsers.mock.calls[0][1]).toBeUndefined()
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })
})
