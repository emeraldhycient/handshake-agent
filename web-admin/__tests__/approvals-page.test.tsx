/**
 * ApprovalsPage tests — the maker-checker approval inbox wired to the real Phase-7
 * approvals subsystem (`useApprovalsInbox` → GET /admin/approvals/inbox; approve /
 * reject → POST /admin/approvals/:id/{approve,reject}).
 *
 *  1. loading → data: a busy skeleton, then one request card per awaiting-me item,
 *     with the tab count badges sourced from the inbox `counts`.
 *  2. Approve → step-up → POST approve: the first attempt 403s with
 *     ADMIN_STEP_UP_REQUIRED, the StepUpDialog opens, re-auth replays the approve
 *     mutation, and the inbox re-fetches (invalidation).
 *  3. Reject → reason → POST reject: opens the ReasonModal, Continue with a reason
 *     fires the reject mutation with that reason (funds-safety: an audited reason is
 *     required before the disposition).
 *  4. My-requests bucket: own requests show the "your own request" guard, no actions.
 *  5. empty + error branches render the design copy / Retry affordance.
 *
 * The api layer is mocked — no server. Funds-safety is asserted structurally: the
 * screen only ever calls the engine-/config-brokered approve/reject clients (never a
 * ledger write), and gates them behind the reason + step-up chain.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  ChangeRequest,
  ChangeRequestInboxResponse,
} from "@handshake-agent/contracts"

import { ApprovalsPage } from "@/components/admin/approvals-page"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/approvals", () => ({
  getApprovalsInbox: vi.fn(),
  approveChange: vi.fn(),
  rejectChange: vi.fn(),
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  stepUp: vi.fn(),
}))

import { getApprovalsInbox, approveChange, rejectChange } from "@/lib/api/approvals"
import { getMe, stepUp } from "@/lib/api/admin"

const mockInbox = vi.mocked(getApprovalsInbox)
const mockApprove = vi.mocked(approveChange)
const mockReject = vi.mocked(rejectChange)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MY_ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const OTHER_ADMIN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

const ME: AdminMe = {
  id: MY_ADMIN_ID,
  email: "me@handshake.test",
  role: { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "super_admin" },
  status: "active",
  mfaEnabled: true,
  permissions: [],
  menus: [],
  pages: [],
}

function change(over: Partial<ChangeRequest> & Pick<ChangeRequest, "id">): ChangeRequest {
  return {
    kind: "pricing_change",
    resource: "pricing.assets.USDT.baseRates.NGN",
    payload: { spread: { from: "85 bps", to: "110 bps" } },
    status: "pending",
    reason: "Cover rising FX volatility on the TRON corridor",
    requestedByAdminId: OTHER_ADMIN_ID,
    requestedByEmail: "tunde@handshake.test",
    decidedByAdminId: null,
    decidedByEmail: null,
    decisionReason: null,
    decidedAt: null,
    createdAt: "2026-06-30T10:00:00.000Z",
    ...over,
  }
}

const AWAITING = change({ id: "11111111-1111-1111-1111-111111111111" })
const MINE = change({
  id: "22222222-2222-2222-2222-222222222222",
  kind: "refund",
  resource: "Transaction:tx_80257",
  requestedByAdminId: MY_ADMIN_ID,
  requestedByEmail: "me@handshake.test",
})

const INBOX: ChangeRequestInboxResponse = {
  awaitingMe: [AWAITING],
  myRequests: [MINE],
  counts: { awaitingMe: 1, myRequests: 1, myPending: 1 },
}

const EMPTY_INBOX: ChangeRequestInboxResponse = {
  awaitingMe: [],
  myRequests: [],
  counts: { awaitingMe: 0, myRequests: 0, myPending: 0 },
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ApprovalsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockInbox.mockReset()
  mockApprove.mockReset()
  mockReject.mockReset()
  mockGetMe.mockReset()
  mockStepUp.mockReset()
  mockGetMe.mockResolvedValue(ME)
})

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("ApprovalsPage", () => {
  it("renders awaiting-me cards with the inbox count badges", async () => {
    mockInbox.mockResolvedValue(INBOX)
    const { container } = renderPage()

    // Loading branch: a busy skeleton before data arrives.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    // Data branch: the awaiting request's title (kind label · resource) renders.
    expect(
      await screen.findByText(/Pricing change · pricing\.assets\.USDT/)
    ).toBeInTheDocument()

    // Tab count badges come from the inbox `counts`.
    expect(screen.getByRole("tab", { name: /Awaiting me/ })).toHaveTextContent(
      "1"
    )
    expect(screen.getByRole("tab", { name: /My requests/ })).toHaveTextContent(
      "1"
    )
  })

  it("approves via the step-up chain then re-fetches the inbox", async () => {
    mockInbox.mockResolvedValue(INBOX)
    // First approve attempt demands step-up; the replay after re-auth succeeds.
    mockApprove
      .mockRejectedValueOnce(
        new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ ...AWAITING, status: "approved" })
    mockStepUp.mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    renderPage()

    await screen.findByText(/Pricing change · pricing\.assets\.USDT/)

    await user.click(screen.getByRole("button", { name: "Approve" }))

    // The step-up dialog opens after the 403.
    const totp = await screen.findByLabelText(/Authenticator code/)
    await user.type(totp, "123456")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    // Re-auth ran, then the approve mutation replayed against the same request id.
    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(2))
    expect(mockApprove).toHaveBeenLastCalledWith(AWAITING.id)

    // Success invalidates the inbox → an extra read beyond the initial load.
    await waitFor(() => expect(mockInbox.mock.calls.length).toBeGreaterThan(1))
  })

  it("rejects only after an audited reason is captured", async () => {
    mockInbox.mockResolvedValue(INBOX)
    mockReject.mockResolvedValue({ ...AWAITING, status: "rejected" })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText(/Pricing change · pricing\.assets\.USDT/)

    await user.click(screen.getByRole("button", { name: "Reject" }))

    // The reason modal opens; Continue is inert until a reason is entered.
    const reason = await screen.findByLabelText("Reason")
    await user.type(reason, "Spread change not justified by current volatility")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith(AWAITING.id, {
        reason: "Spread change not justified by current volatility",
      })
    )
    // Funds-safety: reject fired, approve never did.
    expect(mockApprove).not.toHaveBeenCalled()
  })

  it("shows the dual-control guard (no actions) for my own requests", async () => {
    mockInbox.mockResolvedValue(INBOX)
    const user = userEvent.setup()
    renderPage()

    await screen.findByText(/Pricing change · pricing\.assets\.USDT/)
    await user.click(screen.getByRole("tab", { name: /My requests/ }))

    expect(
      await screen.findByText(/Your own request/)
    ).toBeInTheDocument()
    // No live disposition actions on an own-request card.
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull()
  })

  it("renders the empty (inbox-zero) branch", async () => {
    mockInbox.mockResolvedValue(EMPTY_INBOX)
    renderPage()

    expect(await screen.findByText("Inbox zero")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Awaiting me/ })).toHaveTextContent(
      "0"
    )
  })

  it("surfaces a tokened error with a Retry that refetches", async () => {
    mockInbox.mockRejectedValueOnce(new Error("boom"))
    const user = userEvent.setup()
    renderPage()

    expect(
      await screen.findByText("Failed to load the approvals inbox")
    ).toBeInTheDocument()

    mockInbox.mockResolvedValue(INBOX)
    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(
      await screen.findByText(/Pricing change · pricing\.assets\.USDT/)
    ).toBeInTheDocument()
  })
})
