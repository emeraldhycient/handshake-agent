/**
 * NotificationsMenu (topbar bell) — REAL derived operator alerts (Phase 8, F-mock-b).
 *
 * The bell dropdown no longer renders a hardcoded ALERTS mock. Its rows are DERIVED
 * from existing read hooks (no new endpoint):
 *   • approvals awaiting me   ← useApprovalsInbox().counts.awaitingMe → /approvals
 *   • open reconciliation breaks ← useReconStatus().openBreakCount   → /reconciliation
 *   • stuck transactions      ← useTransactions({}).counts.stuck      → /transactions
 *   • open compliance cases   ← useComplianceEvents({}) flagged/under_review → /compliance
 * The unread badge is the count of ACTIVE alerts (those with a non-zero signal), and
 * the empty branch ("All clear") shows when every signal is zero. The api clients
 * behind the hooks are mocked — no server. Nothing here moves money (§3.1).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminTxnListResponse,
  ChangeRequestInboxResponse,
  ComplianceEventListResponse,
  ReconStatus,
} from "@handshake-agent/contracts"

import { NotificationsMenu } from "@/components/admin/notifications-menu"

// ─── Router mock (design chrome navigates on select) ──────────────────────────────
const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

// ─── Api-client mocks the derived hooks call ──────────────────────────────────────
vi.mock("@/lib/api/approvals", () => ({ getApprovalsInbox: vi.fn() }))
vi.mock("@/lib/api/reconciliation", () => ({ getReconStatus: vi.fn() }))
vi.mock("@/lib/api/transactions", () => ({ listTransactions: vi.fn() }))
vi.mock("@/lib/api/compliance", () => ({ listComplianceEvents: vi.fn() }))
// useReconStatus is also composed by useNavBadges → useKycQueue; that KYC path is
// unused here (the menu reads recon/txn/approvals/compliance directly), so no kyc mock.

import { getApprovalsInbox } from "@/lib/api/approvals"
import { getReconStatus } from "@/lib/api/reconciliation"
import { listTransactions } from "@/lib/api/transactions"
import { listComplianceEvents } from "@/lib/api/compliance"

const mockApprovals = vi.mocked(getApprovalsInbox)
const mockRecon = vi.mocked(getReconStatus)
const mockTxns = vi.mocked(listTransactions)
const mockCompliance = vi.mocked(listComplianceEvents)

// ─── Fixtures ─────────────────────────────────────────────────────────────────────

const inbox = (awaitingMe: number): ChangeRequestInboxResponse => ({
  awaitingMe: [],
  myRequests: [],
  counts: { awaitingMe, myRequests: 0, myPending: 0 },
})

const recon = (openBreakCount: number): ReconStatus => ({
  enabled: true,
  lastRunAt: "2026-07-01T00:00:00.000Z",
  nextRunAt: "2026-07-02T00:00:00.000Z",
  intervalSeconds: 3600,
  openBreakCount,
})

const txns = (stuck: number): AdminTxnListResponse => ({
  items: [],
  counts: { all: 0, stuck, failed: 0, refunds: 0 },
  nextCursor: null,
})

const complianceEvent = (
  id: string,
  status: ComplianceEventListResponse["items"][number]["status"]
): ComplianceEventListResponse["items"][number] => ({
  id,
  userId: "00000000-0000-0000-0000-000000000001",
  transactionId: null,
  eventType: "sanctions_hit",
  severity: "high",
  status,
  screeningProvider: "sardine",
  ruleOrHit: "OFAC",
  createdAt: "2026-07-01T00:00:00.000Z",
})

const compliance = (
  ...statuses: ComplianceEventListResponse["items"][number]["status"][]
): ComplianceEventListResponse => ({
  items: statuses.map((s, i) => complianceEvent(`c${i}`, s)),
  nextCursor: null,
})

function renderMenu() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsMenu />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  push.mockReset()
  mockApprovals.mockReset()
  mockRecon.mockReset()
  mockTxns.mockReset()
  mockCompliance.mockReset()
})

describe("NotificationsMenu (real derived alerts)", () => {
  it("derives an unread badge from the count of active alerts", async () => {
    mockApprovals.mockResolvedValue(inbox(2))
    mockRecon.mockResolvedValue(recon(3))
    mockTxns.mockResolvedValue(txns(5))
    mockCompliance.mockResolvedValue(compliance("flagged", "under_review"))
    renderMenu()

    // Four active signals → the bell announces "4 unread".
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /4 unread/i })
      ).toBeInTheDocument()
    )
  })

  it("renders one row per active alert with its real count and links to its screen", async () => {
    const user = userEvent.setup()
    mockApprovals.mockResolvedValue(inbox(2))
    mockRecon.mockResolvedValue(recon(3))
    mockTxns.mockResolvedValue(txns(5))
    mockCompliance.mockResolvedValue(compliance("flagged"))
    renderMenu()

    await user.click(await screen.findByRole("button", { name: /unread/i }))

    // Each active alert renders with its real count baked into the title.
    expect(
      await screen.findByText(/2 approvals? awaiting you/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/3 reconciliation breaks?/i)).toBeInTheDocument()
    expect(
      screen.getByText(/5 transactions? stuck in settlement/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/1 open compliance case/i)).toBeInTheDocument()

    // Selecting the reconciliation alert navigates to its screen.
    await user.click(screen.getByText(/3 reconciliation breaks?/i))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reconciliation"))
  })

  it("hides zero-signal alerts (only active alerts show)", async () => {
    const user = userEvent.setup()
    mockApprovals.mockResolvedValue(inbox(0))
    mockRecon.mockResolvedValue(recon(0))
    mockTxns.mockResolvedValue(txns(4))
    mockCompliance.mockResolvedValue(compliance())
    renderMenu()

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /1 unread/i })
      ).toBeInTheDocument()
    )

    await user.click(screen.getByRole("button", { name: /unread/i }))

    // Only the stuck-transaction alert is active.
    expect(
      await screen.findByText(/4 transactions? stuck in settlement/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/awaiting you/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/reconciliation breaks?/i)).not.toBeInTheDocument()
  })

  it("shows an 'All clear' empty state when every signal is zero", async () => {
    const user = userEvent.setup()
    mockApprovals.mockResolvedValue(inbox(0))
    mockRecon.mockResolvedValue(recon(0))
    mockTxns.mockResolvedValue(txns(0))
    mockCompliance.mockResolvedValue(compliance("approved", "dismissed"))
    renderMenu()

    // No active alerts → no unread badge on the bell.
    await waitFor(() => expect(mockTxns).toHaveBeenCalled())
    expect(
      screen.getByRole("button", { name: "Alerts" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /unread/i })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Alerts" }))
    expect(await screen.findByText(/all clear/i)).toBeInTheDocument()
  })
})
