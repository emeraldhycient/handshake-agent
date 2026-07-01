/**
 * TransactionDetail tests (READ-wired, Phase 6a).
 *
 * The screen now fetches its record via `getTransaction` (GET
 * /admin/transactions/:id) through `useTransactionDetail`. These tests mock the
 * api client and assert:
 *  1. loading → data: the header (type + status pill + copyable id), the real
 *     ledger legs, timeline steps and provider references render from the fetched
 *     `AdminTxnDetail`; the Open-ledger link deep-links the REAL tx id.
 *  2. error branch: a tokened failure card with a Retry affordance.
 *  3. empty ledger/timeline: design-consistent empty states, no crash.
 *
 * The api layer is mocked — no server. The flow-modal triage actions are Phase 7
 * (propose-only here) so they are not asserted beyond being present.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminTxnDetail } from "@handshake-agent/contracts"

import { TransactionDetail } from "@/components/admin/transaction-detail"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/transactions", () => ({
  getTransaction: vi.fn(),
}))

import { getTransaction } from "@/lib/api/transactions"

const mockGet = vi.mocked(getTransaction)

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
  mockGet.mockResolvedValue(DETAIL)
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
})
