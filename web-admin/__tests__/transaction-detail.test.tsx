/**
 * TransactionDetail tests.
 *
 * READ (Phase 6a): the screen fetches its record via `getTransaction` (GET
 * /admin/transactions/:id) through `useTransactionDetail`. WRITE (Phase 7): the
 * triage actions are wired to the REAL engine-brokered / maker-checker mutations —
 * Retry → `retryTransaction`, Mark failed → `markTransactionFailed`, Refund →
 * `createChange` (a `kind: refund` change request; four-eyes, applies nothing here).
 *
 * These tests mock the api layer (no server) and assert:
 *  1. loading → data: the header, real ledger legs, timeline, provider refs render;
 *     Open-ledger deep-links the REAL tx id.
 *  2. error / empty branches.
 *  3. WRITES: retry fires the engine retry; mark-failed threads the reason; refund
 *     raises a `kind: refund` change request against this transaction — never a raw
 *     ledger write from this surface (§3.1).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminTxnDetail } from "@handshake-agent/contracts"

import { TransactionDetail } from "@/components/admin/transaction-detail"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/transactions", () => ({
  getTransaction: vi.fn(),
  retryTransaction: vi.fn(),
  markTransactionFailed: vi.fn(),
}))

vi.mock("@/lib/api/approvals", () => ({
  createChange: vi.fn(),
}))

// `useAdminMe` only drives the StepUpDialog's mfa mode (no step-up in these tests).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import {
  getTransaction,
  retryTransaction,
  markTransactionFailed,
} from "@/lib/api/transactions"
import { createChange } from "@/lib/api/approvals"
import { getMe } from "@/lib/api/admin"

const mockGet = vi.mocked(getTransaction)
const mockRetry = vi.mocked(retryTransaction)
const mockMarkFailed = vi.mocked(markTransactionFailed)
const mockCreateChange = vi.mocked(createChange)
const mockGetMe = vi.mocked(getMe)

// ─── Fixture ────────────────────────────────────────────────────────────────────

const TXN_ID = "11111111-1111-4111-8111-111111111111"
const USER_ID = "22222222-2222-4222-8222-222222222222"

const DETAIL: AdminTxnDetail = {
  id: TXN_ID,
  userId: USER_ID,
  userEmail: "amara.okeke@example.com",
  type: "receive",
  status: "settling",
  idempotencyKey: "idem_15020323",
  processorTxRef: "MockFLWRef-902412",
  onChainTxHash: "TJ173305038490070x9",
  failureReason: null,
  createdAt: "2026-07-01T13:28:00.000Z",
  executedAt: "2026-07-01T13:28:02.000Z",
  completedAt: null,
  failedAt: null,
  economics: {
    asset: "USDT",
    amount: "236.599531",
    fiatAmount: "251904.85",
    fiatCurrency: "NGN",
    rate: "1064.72",
    processingFee: "1250.00",
    fxSpreadBps: "150",
    internalMargin: "3778.57",
  },
  ledgerLegs: [
    {
      accountType: "user",
      accountId: USER_ID,
      currency: "NGN",
      amount: "251904.85",
      direction: "debit",
      balanceAfter: "0.00",
      sequence: 11,
      postedAt: "2026-07-01T13:28:02.000Z",
    },
    {
      accountType: "user",
      accountId: USER_ID,
      currency: "USDT",
      amount: "236.599531",
      direction: "credit",
      balanceAfter: "236.599531",
      sequence: 12,
      postedAt: "2026-07-01T13:28:02.000Z",
    },
  ],
  timeline: [
    { status: "pending", at: "2026-07-01T13:28:00.000Z" },
    { status: "settling", at: "2026-07-01T13:28:02.000Z" },
  ],
  providerReferences: [
    { provider: "tron", reference: "TJ173305038490070x9" },
    { provider: "flutterwave", reference: "MockFLWRef-902412" },
    { provider: "blockradar", reference: "br_wd_88213" },
  ],
}

function renderDetail(id = TXN_ID) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TransactionDetail transactionId={id} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGet.mockReset()
  mockRetry.mockReset()
  mockMarkFailed.mockReset()
  mockCreateChange.mockReset()
  mockGetMe.mockReset()
  mockGet.mockResolvedValue(DETAIL)
  mockGetMe.mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000001",
    email: "ops@example.com",
    role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
    status: "active",
    mfaEnabled: false,
    permissions: [],
    menus: [],
    pages: [],
  })
  mockRetry.mockResolvedValue({
    transactionId: TXN_ID,
    status: "settling",
    refunded: false,
  })
  mockMarkFailed.mockResolvedValue({
    transactionId: TXN_ID,
    status: "failed",
    refunded: true,
  })
  mockCreateChange.mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    kind: "refund",
    resource: `Transaction:${TXN_ID}`,
    payload: { transactionId: TXN_ID, reason: "Customer request" },
    status: "pending",
    reason: "Customer request",
    requestedByAdminId: "00000000-0000-0000-0000-000000000001",
    requestedByEmail: "ops@example.com",
    decidedByAdminId: null,
    decidedByEmail: null,
    decisionReason: null,
    decidedAt: null,
    createdAt: "2026-07-01T13:30:00.000Z",
  })
})

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("TransactionDetail (read-wired)", () => {
  it("fetches the route id and renders the header, ledger legs, timeline and refs", async () => {
    renderDetail()

    // loading → data: the fetched transaction id appears (copyable header).
    expect(await screen.findByText(TXN_ID)).toBeInTheDocument()
    // The client was called with the real route id.
    expect(mockGet).toHaveBeenCalledWith(TXN_ID)

    // Status pill for a settling txn → "Pending settlement".
    expect(screen.getByText("Pending settlement")).toBeInTheDocument()

    // Real ledger legs: account keys + directions.
    expect(screen.getByText(`user:${USER_ID}:NGN`)).toBeInTheDocument()
    expect(screen.getByText(`user:${USER_ID}:USDT`)).toBeInTheDocument()
    expect(screen.getByText("DEBIT")).toBeInTheDocument()
    expect(screen.getByText("CREDIT")).toBeInTheDocument()
    expect(screen.getByText("251904.85")).toBeInTheDocument()

    // Provider references from the projection (TRON + Flutterwave + Blockradar + idem).
    expect(screen.getByText("TJ173305038490070x9")).toBeInTheDocument()
    expect(screen.getByText("MockFLWRef-902412")).toBeInTheDocument()
    expect(screen.getByText("br_wd_88213")).toBeInTheDocument()
    expect(screen.getByText("Blockradar")).toBeInTheDocument()
    expect(screen.getByText("idem_15020323")).toBeInTheDocument()

    // Timeline steps render (two entries).
    expect(screen.getByText("settling")).toBeInTheDocument()
  })

  it("renders the itemized economics and the ledger Seq column", async () => {
    renderDetail()

    await screen.findByText(TXN_ID)
    // Itemized economics projected from metadata.
    expect(screen.getByText("236.599531 USDT")).toBeInTheDocument()
    expect(screen.getByText("NGN 251904.85")).toBeInTheDocument()
    expect(screen.getByText("1064.72")).toBeInTheDocument()
    expect(screen.getByText("1250.00")).toBeInTheDocument()
    expect(screen.getByText("150 bps")).toBeInTheDocument()
    // Operator-only internal margin.
    expect(screen.getByText("3778.57")).toBeInTheDocument()
    // Ledger Seq column shows the per-account sequence numbers.
    expect(screen.getByText("11")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
  })

  it("uses the amount in the header title (type · amount asset)", async () => {
    renderDetail()

    await screen.findByText(TXN_ID)
    expect(
      screen.getByRole("heading", { name: /receive · 236.599531 USDT/i })
    ).toBeInTheDocument()
  })

  it("deep-links Open ledger to the REAL transaction id", async () => {
    renderDetail()

    await screen.findByText(TXN_ID)
    expect(screen.getByRole("link", { name: /Open ledger/ })).toHaveAttribute(
      "href",
      `/ledger?tx=${TXN_ID}`
    )
  })

  it("renders a tokened error card with a Retry affordance on failure", async () => {
    mockGet.mockRejectedValue(new Error("boom"))
    renderDetail()

    expect(
      await screen.findByText("Failed to load transaction")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("shows a design-consistent empty state when there are no ledger legs", async () => {
    mockGet.mockResolvedValue({ ...DETAIL, ledgerLegs: [], timeline: [] })
    renderDetail()

    expect(
      await screen.findByText("No ledger legs posted yet.")
    ).toBeInTheDocument()
    expect(
      screen.getByText("No lifecycle events recorded.")
    ).toBeInTheDocument()
  })

  it("omits the Tronscan/Flutterwave rows when the projection has no such refs", async () => {
    mockGet.mockResolvedValue({
      ...DETAIL,
      onChainTxHash: null,
      processorTxRef: null,
      providerReferences: [],
    })
    renderDetail()

    await screen.findByText(TXN_ID)
    // Idempotency is always present; the provider-specific refs are gone.
    await waitFor(() =>
      expect(screen.getByText("idem_15020323")).toBeInTheDocument()
    )
    expect(screen.queryByText("TJ173305038490070x9")).not.toBeInTheDocument()
    expect(screen.queryByText("MockFLWRef-902412")).not.toBeInTheDocument()
  })

  // ── WRITES (Phase 7) — engine-brokered + maker-checker triage ───────────────────

  it("Retry settlement → engine modal → fires the engine-brokered retry for this tx", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Retry settlement" }))
    // The engine-action modal shows this tx's idempotency key (not a mock const).
    expect(await screen.findAllByText("idem_15020323")).not.toHaveLength(0)
    await user.click(
      screen.getByRole("button", { name: "Execute retry via engine" })
    )

    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith(TXN_ID))
    // Retry moves no money itself — never a mark-failed/refund from this action.
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockCreateChange).not.toHaveBeenCalled()
  })

  it("Mark failed → reason → engine → calls the engine mark-failed with the reason", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Mark failed" }))
    // ReasonModal: a required reason gates Continue.
    await user.type(
      screen.getByLabelText("Reason"),
      "Stuck settlement, manual fail"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.click(
      screen.getByRole("button", { name: "Mark failed via engine" })
    )

    await waitFor(() =>
      expect(mockMarkFailed).toHaveBeenCalledWith(TXN_ID, {
        reason: "Stuck settlement, manual fail",
      })
    )
    expect(mockCreateChange).not.toHaveBeenCalled()
  })

  it("Refund → reason → maker-checker → raises a `kind: refund` change request (four-eyes, no direct money move)", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Refund" }))
    await user.type(screen.getByLabelText("Reason"), "Duplicate charge")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    // The maker-checker modal (dual-control) is what a refund submits through.
    await user.click(
      screen.getByRole("button", { name: "Submit for approval" })
    )

    await waitFor(() =>
      expect(mockCreateChange).toHaveBeenCalledWith({
        kind: "refund",
        resource: `Transaction:${TXN_ID}`,
        payload: { transactionId: TXN_ID, reason: "Duplicate charge" },
        reason: "Duplicate charge",
      })
    )
    // A refund NEVER executes an engine action from this surface — it only proposes.
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockRetry).not.toHaveBeenCalled()
  })

  it("Resend receipt is a local confirmation — it fires no mutation", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Resend receipt" }))

    expect(mockRetry).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockCreateChange).not.toHaveBeenCalled()
  })
})
