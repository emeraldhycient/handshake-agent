/**
 * UsersPage + UserActions tests.
 *
 *  1. The users table renders a row per user and shows the SIM-swap badge only
 *     for a flagged user.
 *  2. An adjust-tier action that 403s with ADMIN_STEP_UP_REQUIRED opens the
 *     step-up dialog (the `useStepUpRetry` flow).
 *
 * The api layer is mocked — no server. `@/lib/api/admin` (getMe), `@/lib/api/users`,
 * and `@/lib/query/auth` (useStepUp, exercised by the dialog) are stubbed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminEndUserDetail,
  AdminEndUserListResponse,
  AdminMe,
} from "@handshake-agent/contracts"

import { UsersPage } from "@/components/admin/users-page"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

vi.mock("@/lib/api/users", () => ({
  listEndUsers: vi.fn(),
  getEndUser: vi.fn(),
  adjustTier: vi.fn(),
  setEndUserStatus: vi.fn(),
  forcePinReset: vi.fn(),
  revokeDevice: vi.fn(),
  simSwapReverify: vi.fn(),
}))

import { getMe } from "@/lib/api/admin"
import { listEndUsers, getEndUser, adjustTier } from "@/lib/api/users"

const mockGetMe = vi.mocked(getMe)
const mockListEndUsers = vi.mocked(listEndUsers)
const mockGetEndUser = vi.mocked(getEndUser)
const mockAdjustTier = vi.mocked(adjustTier)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN_ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
  status: "active",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

const LIST: AdminEndUserListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "flagged@example.com",
      status: "active",
      kycStatus: "verified",
      kycTier: "tier_2",
      simSwapFlagged: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "clean@example.com",
      status: "active",
      kycStatus: "pending_review",
      kycTier: "tier_1",
      simSwapFlagged: false,
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  nextCursor: null,
}

const DETAIL: AdminEndUserDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "flagged@example.com",
  status: "active",
  kycStatus: "verified",
  kycTier: "tier_2",
  simSwapDetectedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  devices: [],
  balances: [],
  recentTransactions: [],
  recentLedger: [],
  beneficiaries: [],
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
  mockGetMe.mockReset()
  mockListEndUsers.mockReset()
  mockGetEndUser.mockReset()
  mockAdjustTier.mockReset()
  mockGetMe.mockResolvedValue(ADMIN_ME)
  mockListEndUsers.mockResolvedValue(LIST)
  mockGetEndUser.mockResolvedValue(DETAIL)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UsersPage", () => {
  it("renders a row per user and a SIM-swap badge only for the flagged user", async () => {
    renderPage()

    expect(await screen.findByText("flagged@example.com")).toBeInTheDocument()
    expect(screen.getByText("clean@example.com")).toBeInTheDocument()

    // The SIM-swap badge appears exactly once (the flagged user).
    const badges = screen.getAllByText("SIM swap")
    expect(badges).toHaveLength(1)
  })

  it("opens the step-up dialog when adjust-tier returns ADMIN_STEP_UP_REQUIRED", async () => {
    mockAdjustTier.mockRejectedValue(
      new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
    )

    const user = userEvent.setup()
    renderPage()

    // Open the detail drawer for the flagged user.
    await user.click(await screen.findByText("flagged@example.com"))

    // The drawer's tier select loads from the detail aggregate.
    const tierSelect = await screen.findByLabelText("Adjust KYC tier")
    // Change tier (current is tier_2) → triggers the sensitive mutation.
    await user.selectOptions(tierSelect, "tier_3")

    await waitFor(() => expect(mockAdjustTier).toHaveBeenCalled())

    // The step-up dialog surfaces on the 403.
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
  })
})
