/**
 * LedgerPage tests — wired to the real ledger-history endpoint via
 * `useLedgerHistory` (GET /admin/ledger). The api client is mocked; no server.
 *
 * The endpoint needs a full (accountType, accountId, currency) triple, so the
 * query is idle until an account id is entered — the tests type an id to trigger
 * the fetch, then assert:
 *   1. idle empty state before any account id, then loading → data after entry;
 *   2. the projected columns (Seq / Account / Dir / Amount / Running / Source
 *      link) render from the mocked `AdminLedgerEntry` rows;
 *   3. an errored query surfaces the inline error + Retry affordance;
 *   4. the Export button still fires its toast stand-in (Phase 7 write path).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminLedgerEntry } from "@handshake-agent/contracts"

import { LedgerPage } from "@/components/admin/ledger-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/ledger", () => ({
  listLedgerHistory: vi.fn(),
}))

import { listLedgerHistory } from "@/lib/api/ledger"

const mockHistory = vi.mocked(listLedgerHistory)

// ─── Fixture ──────────────────────────────────────────────────────────────────

const ENTRIES: AdminLedgerEntry[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    transactionId: "tx_80231",
    accountType: "user_wallet",
    accountId: "usr_10480",
    currency: "NGN",
    amount: "106469.00",
    direction: "debit",
    balanceAfter: "893531.00",
    sequence: 44920,
    postedAt: "2026-07-01T09:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    transactionId: "tx_80244",
    accountType: "user_wallet",
    accountId: "usr_10480",
    currency: "NGN",
    amount: "53200.00",
    direction: "credit",
    balanceAfter: "159669.00",
    sequence: 44921,
    postedAt: "2026-07-01T09:05:00.000Z",
  },
]

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
  defaultToastStore.setState({ toasts: [] })
  mockHistory.mockReset()
  mockHistory.mockResolvedValue({ entries: ENTRIES })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LedgerPage", () => {
  it("renders the header + the sequence-integrity pill", () => {
    renderPage()

    expect(screen.getByRole("heading", { name: "Ledger" })).toBeInTheDocument()
    expect(screen.getByText("Sequence integrity OK")).toBeInTheDocument()
  })

  it("stays idle until an account id is entered, then loads real entries", async () => {
    const user = userEvent.setup()
    renderPage()

    // Idle: the query is disabled (no account id) → prompt empty state, no fetch.
    expect(mockHistory).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Enter an account id to view its double-entry ledger/i)
    ).toBeInTheDocument()

    // Entering an account id completes the triple → the endpoint is called and
    // the projected rows render.
    await user.type(screen.getByLabelText("Account id"), "usr_10480")

    // Typing grows the id keystroke-by-keystroke; the completed triple is the
    // one that resolves the visible rows, so assert on the latest call's args.
    await waitFor(() => expect(mockHistory).toHaveBeenCalled())
    const lastCall = mockHistory.mock.calls.at(-1)
    expect(lastCall?.[0]).toMatchObject({
      accountType: "user_wallet",
      accountId: "usr_10480",
      currency: "NGN",
    })

    // Account (accountType:accountId:currency) renders for each of the two legs;
    // the NGN-formatted amount, the direction pill, and the Source → tx-detail
    // link all project from the mocked entries.
    expect(
      await screen.findAllByText("user_wallet:usr_10480:NGN")
    ).toHaveLength(2)
    expect(screen.getByText("₦106,469.00")).toBeInTheDocument()
    expect(screen.getByText("DEBIT")).toBeInTheDocument()
    expect(screen.getByText("CREDIT")).toBeInTheDocument()
    const source = screen.getByRole("link", { name: "tx_80231" })
    expect(source).toHaveAttribute("href", "/transactions/tx_80231")
  })

  it("shows an inline error with a Retry affordance when the query fails", async () => {
    const user = userEvent.setup()
    mockHistory.mockRejectedValue(new Error("boom"))
    renderPage()

    await user.type(screen.getByLabelText("Account id"), "usr_10480")

    expect(
      await screen.findByText(/Couldn.t load ledger entries/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("renders an empty state when the account has no entries", async () => {
    const user = userEvent.setup()
    mockHistory.mockResolvedValue({ entries: [] })
    renderPage()

    await user.type(screen.getByLabelText("Account id"), "usr_99999")

    expect(
      await screen.findByText(
        /No ledger entries for this account and currency/i
      )
    ).toBeInTheDocument()
  })

  it("toasts the CSV export confirmation when Export is clicked", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole("button", { name: /Export/i }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe("Exporting ledger to CSV…")
    expect(toasts[0].kind).toBe("info")
  })
})
