/**
 * LedgerPage test.
 *
 *  5. Verifying a transaction's integrity shows the balanced / broken result.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminLedgerIntegrityResult } from "@handshake-agent/contracts"

import { LedgerPage } from "@/components/admin/ledger-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/ledger", () => ({
  listLedgerHistory: vi.fn(),
  verifyLedger: vi.fn(),
}))

import { listLedgerHistory, verifyLedger } from "@/lib/api/ledger"

const mockHistory = vi.mocked(listLedgerHistory)
const mockVerify = vi.mocked(verifyLedger)

const BALANCED: AdminLedgerIntegrityResult = {
  transactionId: "tx-1",
  balanced: true,
  legCount: 4,
  brokenAt: null,
}

const BROKEN: AdminLedgerIntegrityResult = {
  transactionId: "tx-2",
  balanced: false,
  legCount: 3,
  brokenAt: "USDT",
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <LedgerPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockHistory.mockReset()
  mockVerify.mockReset()
  mockHistory.mockResolvedValue({ entries: [] })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LedgerPage", () => {
  it("shows a balanced result after verifying a sound transaction", async () => {
    mockVerify.mockResolvedValue(BALANCED)
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText("Transaction id"),
      "11111111-1111-1111-1111-111111111111"
    )
    await user.click(screen.getByRole("button", { name: "Verify" }))

    await waitFor(() => expect(mockVerify).toHaveBeenCalled())
    expect(await screen.findByText("Balanced")).toBeInTheDocument()
    expect(screen.getByText(/all currencies net to zero/i)).toBeInTheDocument()
  })

  it("shows an imbalanced result with the breaking currency", async () => {
    mockVerify.mockResolvedValue(BROKEN)
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText("Transaction id"),
      "22222222-2222-2222-2222-222222222222"
    )
    await user.click(screen.getByRole("button", { name: "Verify" }))

    expect(await screen.findByText("Imbalanced")).toBeInTheDocument()
    expect(screen.getByText(/breaks at USDT/i)).toBeInTheDocument()
  })
})
