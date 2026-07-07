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
  rerunReconciliation: vi.fn(),
}))

vi.mock("@/lib/api/approvals", () => ({
  createChange: vi.fn(),
}))

// `useAdminMe` only drives the StepUpDialog's mfa mode (no step-up in these tests).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  stepUp: vi.fn(),
}))

import {
  getTransaction,
  retryTransaction,
  markTransactionFailed,
  rerunReconciliation,
} from "@/lib/api/transactions"
import { createChange } from "@/lib/api/approvals"
import { getMe, stepUp } from "@/lib/api/admin"

const mockGet = vi.mocked(getTransaction)
const mockRetry = vi.mocked(retryTransaction)
const mockMarkFailed = vi.mocked(markTransactionFailed)
const mockCreateChange = vi.mocked(createChange)
const mockRerunRecon = vi.mocked(rerunReconciliation)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

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
    realizedFee: "1250",
    realizedSpread: "2528.57",
    realizedProfit: "3778.57",
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
  mockRerunRecon.mockReset()
  mockGetMe.mockReset()
  mockGet.mockResolvedValue(DETAIL)
  // Default: re-run recon finds no discrepancies (the reconciled path).
  mockRerunRecon.mockResolvedValue({ items: [] })
  mockGetMe.mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000001",
    email: "ops@example.com",
    role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
    status: "active",
    displayName: "Test Admin",
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
    // NGN leg is currency-formatted (also appears as the economics fiat leg → 2 nodes).
    expect(screen.getAllByText("₦251,904.85").length).toBeGreaterThan(0)

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
    // Itemized economics projected from metadata (fiat amounts currency-formatted,
    // crypto thousands-separated). Each value also appears as its ledger leg → 2 nodes.
    expect(screen.getAllByText("236.599531 USDT").length).toBeGreaterThan(0)
    expect(screen.getAllByText("₦251,904.85").length).toBeGreaterThan(0)
    expect(screen.getByText("1064.72")).toBeInTheDocument()
    expect(screen.getByText("150 bps")).toBeInTheDocument()
    // Operator-only internal margin (unformatted rate delta).
    expect(screen.getByText("3778.57")).toBeInTheDocument()
    // Operator-only realized economics (fee + spread from computeTxProfit).
    expect(screen.getByText("Realized profit (operator)")).toBeInTheDocument()
    expect(screen.getByText("₦3,778.57")).toBeInTheDocument()
    expect(screen.getByText("₦2,528.57")).toBeInTheDocument()
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

  it("Re-run recon → engine modal → fires the re-run for this tx and shows the reconciled (no-breaks) result", async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Re-run recon" }))
    await user.click(
      screen.getByRole("button", { name: "Run reconciliation" })
    )

    await waitFor(() =>
      expect(mockRerunRecon).toHaveBeenCalledWith(TXN_ID, undefined)
    )
    // The reconciled (empty) result renders — provider and ledger agree.
    expect(
      await screen.findByText(/Provider and ledger reconcile/i)
    ).toBeInTheDocument()
    // A read-only detection — it never moves money from this surface.
    expect(mockRetry).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockCreateChange).not.toHaveBeenCalled()
  })

  it("Re-run recon → shows the detected break rows when the re-run finds discrepancies", async () => {
    const user = userEvent.setup()
    mockRerunRecon.mockResolvedValue({
      items: [
        {
          id: "brk_1",
          kind: "over_credit",
          severity: "high",
          transactionId: TXN_ID,
          asset: "USDT",
          delta: "+50.00",
          detail: "Ledger credited 50.00 USDT more than the provider confirmed.",
          status: "open",
          detectedAt: "2026-07-02T04:00:00.000Z",
        },
      ],
    })
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Re-run recon" }))
    await user.click(
      screen.getByRole("button", { name: "Run reconciliation" })
    )

    // The detected break renders (kind label + signed delta, native precision).
    expect(await screen.findByText("Over-credit")).toBeInTheDocument()
    expect(screen.getByText("+50 USDT")).toBeInTheDocument()
  })

  it("Re-run recon → surfaces an error branch when the re-run fails", async () => {
    const user = userEvent.setup()
    mockRerunRecon.mockRejectedValue(new Error("recon boom"))
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Re-run recon" }))
    await user.click(
      screen.getByRole("button", { name: "Run reconciliation" })
    )

    expect(
      await screen.findByText(/Reconciliation re-run failed/i)
    ).toBeInTheDocument()
  })

  it("Re-run recon → opens step-up and replays after re-auth when the server demands it", async () => {
    const user = userEvent.setup()
    mockGetMe.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      email: "ops@example.com",
      role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
      status: "active",
      displayName: "Test Admin",
      mfaEnabled: true,
      permissions: [],
      menus: [],
      pages: [],
    })
    const { ApiError } = await import("@/lib/api/client")
    mockRerunRecon
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ items: [] })
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Re-run recon" }))
    await user.click(
      screen.getByRole("button", { name: "Run reconciliation" })
    )

    // The re-auth dialog appears (TOTP mode, since mfaEnabled).
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockRerunRecon).toHaveBeenCalledTimes(1)
  })

  it("Retry → 403 opens step-up → REPLAYS the engine retry after re-auth (money path)", async () => {
    const user = userEvent.setup()
    mockGetMe.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      email: "ops@example.com",
      role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
      status: "active",
      displayName: "Test Admin",
      mfaEnabled: true,
      permissions: [],
      menus: [],
      pages: [],
    })
    mockStepUp.mockResolvedValue(undefined as never)
    const { ApiError } = await import("@/lib/api/client")
    // First execute 403s (step-up demanded); the replay after re-auth succeeds.
    mockRetry
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(undefined as never)
    renderDetail()
    await screen.findByText(TXN_ID)

    await user.click(screen.getByRole("button", { name: "Retry settlement" }))
    await user.click(
      screen.getByRole("button", { name: "Execute retry via engine" })
    )

    // The 403 opens re-auth and KEEPS the flow open (submitFlow completed===false).
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    await waitFor(() => expect(mockRetry).toHaveBeenCalledTimes(1))

    // Completing re-auth → onStepUpSuccess → stepUp.retry() replays the SAME
    // engine-brokered retry, then closes the flow (§3.1: step-up-gated money action).
    await user.type(screen.getByLabelText(/Authenticator code/), "123456")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockRetry).toHaveBeenCalledTimes(2))
    expect(mockRetry).toHaveBeenLastCalledWith(TXN_ID)
    await waitFor(() =>
      expect(screen.queryByText("Confirm it's you")).not.toBeInTheDocument()
    )
    // A retry moves no money itself — the replay never triggers mark-failed/refund.
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockCreateChange).not.toHaveBeenCalled()
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
